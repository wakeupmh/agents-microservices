import json
import boto3
import os
from strands import Agent
from strands.models import BedrockModel
from typing import Dict, Any
from dotenv import load_dotenv
from src.tools.event_creator import create_event
from src.tools.memory_manager import get_patient_memory, save_to_memory

load_dotenv()

MEDICAL_AGENT_PROMPT = """
Você é um AGENTE MÉDICO INTELIGENTE especializado em análise de exames laboratoriais.

FERRAMENTAS DISPONÍVEIS:
- get_patient_memory: Acessa histórico e memória do paciente
- save_to_memory: Salva decisões e observações importantes
- create_event: Cria eventos médicos (agendamentos, alertas, revisões)

PROTOCOLO DE TRABALHO:
1. SEMPRE consulte a memória do paciente primeiro
2. Analise valores atuais vs. histórico (tendências são importantes)
3. Salve sua análise na memória para referência futura
4. Se necessário, crie eventos apropriados

REGRAS CRÍTICAS (SEMPRE SEGUIR):
- Glicose > 300mg/dL = URGENTE (create_event imediato)
- Glicose < 50mg/dL = URGENTE (create_event imediato)
- Múltiplos valores críticos = PRIORITY
- Valores estáveis em pacientes controlados = ROUTINE ou NO_ACTION

TIPOS DE EVENTOS:
- appointment: Agendamento de consulta
- alert: Alerta médico urgente
- review: Revisão de protocolo/medicação

ESPECIALISTAS DISPONÍVEIS:
- endocrinologista: Diabetes, hormônios
- cardiologista: Problemas cardíacos
- nefrologista: Problemas renais
- clinico_geral: Casos gerais

URGÊNCIAS:
- urgent: Ação imediata (0-24h)
- priority: Ação prioritária (1-7 dias)
- routine: Acompanhamento normal (30-60 dias)

Sempre explique seu raciocínio e use as ferramentas quando apropriado.
"""

bedrock_model = BedrockModel(
    model_id="us.amazon.nova-micro-v1:0",
    region_name='us-east-1'
)

def medical_analysis(event: Dict[str, Any], _context) -> str:
    """
    Main medical agent function
    """
    try:
        lab_data = None
        
        if 'lab_data' in event:
            lab_data = event['lab_data']
        elif 'detail' in event and 'object' in event['detail']:
            s3_client = boto3.client('s3')
            bucket_name = event['detail']['bucket']['name']
            object_key = event['detail']['object']['key']
            
            response = s3_client.get_object(Bucket=bucket_name, Key=object_key)
            content = response['Body'].read().decode('utf-8')
            lab_data = json.loads(content)
        
        if not lab_data:
            return json.dumps({
                'status': 'error',
                'message': 'Dados laboratoriais não encontrados no evento'
            })
        
        patient_id = lab_data.get('patient_id')
        if not patient_id:
            return json.dumps({
                'status': 'error', 
                'message': 'ID do paciente não encontrado'
            })
        
        critical_check = check_critical_values(lab_data)
        if critical_check['is_critical']:
            save_to_memory(
                patient_id=patient_id,
                event_type='critical_decision',
                data=critical_check
            )
            
            create_event(
                event_type='alert',
                patient_id=patient_id,
                specialist=critical_check['specialist'],
                urgency='urgent',
                reasoning=critical_check['reasoning']
            )
            
            return json.dumps({
                'status': 'critical_handled',
                'action': critical_check['action'],
                'reasoning': critical_check['reasoning']
            })
        
        medical_agent = Agent(
            model=bedrock_model,
            system_prompt=MEDICAL_AGENT_PROMPT,
            tools=[get_patient_memory, save_to_memory, create_event]
        )
        
        user_prompt = f"""
        NOVO EXAME LABORATORIAL RECEBIDO:
        
        Paciente: {patient_id}
        Data: {lab_data.get('exam_date', 'não informada')}
        
        Resultados:
        {json.dumps(lab_data.get('lab_results', {}), indent=2, ensure_ascii=False)}
        
        Informações do Paciente:
        {json.dumps(lab_data.get('patient_info', {}), indent=2, ensure_ascii=False)}
        
        AÇÕES SOLICITADAS:
        1. Consulte a memória do paciente
        2. Analise os resultados considerando o histórico
        3. Salve sua análise na memória
        4. Se necessário, crie eventos apropriados
        5. Forneça um relatório resumido
        """
        
        response = medical_agent(user_prompt)
        
        return json.dumps({
            'status': 'success',
            'patient_id': patient_id,
            'agent_response': str(response),
            'analysis_timestamp': lab_data.get('exam_date')
        })
        
    except Exception as e:
        return json.dumps({
            'status': 'error',
            'message': f'Erro na análise médica: {str(e)}',
            'patient_id': lab_data.get('patient_id', 'unknown') if lab_data else 'unknown'
        })

def check_critical_values(lab_data: Dict) -> Dict:
    """
    Deterministic check for critical cases
    """
    results = lab_data.get('lab_results', {})
    glucose = results.get('glucose', {}).get('value', 0)
    
    if glucose > 300:
        return {
            'is_critical': True,
            'action': 'emergency_appointment',
            'specialist': 'endocrinologista',
            'reasoning': f'Hiperglicemia crítica: {glucose}mg/dL (>300). Risco de cetoacidose.'
        }
    
    if glucose < 50:
        return {
            'is_critical': True,
            'action': 'emergency_appointment',
            'specialist': 'endocrinologista',
            'reasoning': f'Hipoglicemia severa: {glucose}mg/dL (<50). Risco de coma.'
        }
    
    return {'is_critical': False}