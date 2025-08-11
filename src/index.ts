import "dotenv/config";
import { Agent } from "@voltagent/core";
import { VercelAIProvider } from "@voltagent/vercel-ai";
import { memoryTool, eventsTool } from "./tools";
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});

const bedrock = createAmazonBedrock({
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.AWS_SESSION_TOKEN,
});

const instructions = `
  Você é um AGENTE MÉDICO INTELIGENTE especializado em análise de exames laboratoriais.

  FERRAMENTAS DISPONÍVEIS:
  
  1. MEMORY (Ferramenta de Memória):
     - Função: Armazena e recupera registros médicos dos pacientes no DynamoDB
     - Ações disponíveis:
       * "store": Salva novos registros (necessita patient_id, record_id, data)
       * "retrieve": Busca registros existentes (necessita patient_id, record_id opcional)
     - Use para: Consultar histórico, salvar análises, comparar tendências
     - Exemplo: memory(action="retrieve", patient_id="12345") para buscar histórico

  2. CREATE EVENT (Ferramenta de Eventos):
     - Função: Cria eventos médicos no EventBridge para workflows hospitalares
     - Parâmetros obrigatórios:
       * event_type: "appointment", "alert", "review"
       * patient_id: ID do paciente
       * specialist: Especialista recomendado
       * urgency: "routine", "priority", "urgent"
       * reasoning: Justificativa médica detalhada
     - Use para: Agendar consultas, criar alertas urgentes, solicitar revisões

  PROTOCOLO DE TRABALHO OBRIGATÓRIO:
  1. SEMPRE inicie consultando memory para buscar histórico do paciente
  2. Analise valores atuais vs. tendências históricas
  3. Salve sua análise completa na memory para referência futura
  4. Se indicado clinicamente, crie eventos com createEvent

  REGRAS CRÍTICAS DE DECISÃO:
  - Glicose > 300mg/dL = URGENT + createEvent(alert)
  - Glicose < 50mg/dL = URGENT + createEvent(alert)
  - HbA1c > 10% = PRIORITY + createEvent(appointment)
  - Creatinina > 3.0mg/dL = URGENT + createEvent(alert)
  - Múltiplos valores críticos = PRIORITY
  - Valores normais/estáveis = ROUTINE ou observação

  ESPECIALISTAS DISPONÍVEIS:
  - "endocrinologista": Diabetes, tireoide, hormônios
  - "cardiologista": Hipertensão, colesterol, cardiac markers
  - "nefrologista": Creatinina, ureia, problemas renais
  - "generalist": Casos gerais e acompanhamento

  NÍVEIS DE URGÊNCIA:
  - "urgent": Ação imediata (0-24h) - emergências
  - "priority": Ação prioritária (1-7 dias) - alterações importantes
  - "routine": Acompanhamento normal (30-90 dias) - manutenção

  SEMPRE justifique suas decisões e use as ferramentas de forma sequencial e lógica.
`

interface LabData {
  patient_id: string;
  exam_date?: string;
  lab_results?: Record<string, any>;
  patient_info?: Record<string, any>;
}

interface CriticalCheck {
  is_critical: boolean;
  action?: string;
  specialist?: string;
  reasoning?: string;
}

function checkCriticalValues(labData: LabData): CriticalCheck {
  const results = labData.lab_results || {};
  const glucose = results.glucose?.value || 0;
  
  if (glucose > 300) {
    return {
      is_critical: true,
      action: 'emergency_appointment',
      specialist: 'endocrinologista',
      reasoning: `Hiperglicemia crítica: ${glucose}mg/dL (>300). Risco de cetoacidose.`
    };
  }
  
  if (glucose < 50) {
    return {
      is_critical: true,
      action: 'emergency_appointment',
      specialist: 'endocrinologista',
      reasoning: `Hipoglicemia severa: ${glucose}mg/dL (<50). Risco de coma.`
    };
  }
  
  return { is_critical: false };
}

export const handler = async (event: any) => {
  try {
    console.log('EventBridge event received:', JSON.stringify(event));
    
    let labData: LabData | null = null;
    
    if (event.detail?.lab_data) {
      labData = event.detail.lab_data;
    } 
    else if (event.detail?.object) {
      const bucketName = event.detail.bucket.name;
      const objectKey = event.detail.object.key;
      
      console.log(`Retrieving S3 object: ${bucketName}/${objectKey}`);
      
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      });
      
      const response = await s3Client.send(command);
      const content = await response.Body?.transformToString();
      
      if (content) {
        labData = JSON.parse(content);
      }
    }
    
    if (!labData) {
      console.error('No lab data found in event');
      return {
        status: 'error',
        message: 'Dados laboratoriais não encontrados no evento'
      };
    }
    
    const patientId = labData.patient_id;
    if (!patientId) {
      console.error('No patient_id found in lab data');
      return {
        status: 'error',
        message: 'ID do paciente não encontrado'
      };
    }
    
    const criticalCheck = checkCriticalValues(labData);
    if (criticalCheck.is_critical) {
      console.log(`Critical values detected for patient ${patientId}`);
      
      await memoryTool.execute({
        action: 'store',
        patient_id: patientId,
        record_id: `critical_${Date.now()}`,
        data: criticalCheck
      });
      
      await eventsTool.execute({
        event_type: 'alert',
        patient_id: patientId,
        specialist: criticalCheck.specialist!,
        urgency: 'urgent',
        reasoning: criticalCheck.reasoning!
      });
      
      return {
        status: 'critical_handled',
        action: criticalCheck.action,
        reasoning: criticalCheck.reasoning
      };
    }
    
    const agent = new Agent({
      name: "medical-agent",
      instructions,
      llm: new VercelAIProvider(),
      model: bedrock('amazon.nova-micro-v1:0'),
      tools: [memoryTool, eventsTool],
    });
    
    const userPrompt = `
NOVO EXAME LABORATORIAL RECEBIDO:

Paciente: ${patientId}
Data: ${labData.exam_date || 'não informada'}

Resultados:
${JSON.stringify(labData.lab_results || {}, null, 2)}

Informações do Paciente:
${JSON.stringify(labData.patient_info || {}, null, 2)}

AÇÕES SOLICITADAS:
1. Consulte a memória do paciente
2. Analise os resultados considerando o histórico
3. Salve sua análise na memória
4. Se necessário, crie eventos apropriados
5. Forneça um relatório resumido
`;
    
    console.log(`Processing lab analysis for patient ${patientId}`);
    const result = await agent.generateText(userPrompt);
    
    return {
      status: 'success',
      patient_id: patientId,
      agent_response: result.text,
      analysis_timestamp: labData.exam_date
    };
    
  } catch (error) {
    console.error('Error in medical analysis:', error);
    return {
      status: 'error',
      message: `Erro na análise médica: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
};