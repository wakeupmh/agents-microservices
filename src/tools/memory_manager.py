import boto3
from datetime import datetime, timedelta
from typing import Dict, Any, List

def get_patient_memory(patient_id: str, days_back: int = 90) -> Dict[str, Any]:
    """
    Tool para acessar memória/histórico do paciente no DynamoDB
    
    Args:
        patient_id: ID do paciente
        days_back: Quantos dias buscar no histórico
    
    Returns:
        Dict com histórico do paciente
    """
    dynamodb = boto3.resource('dynamodb')
    memory_table = dynamodb.Table('medical-agent-memory')
    
    try:
        # Buscar registros recentes
        cutoff_date = (datetime.now() - timedelta(days=days_back)).isoformat()
        
        response = memory_table.query(
            KeyConditionExpression='patient_id = :pid',
            FilterExpression='created_at > :date',
            ExpressionAttributeValues={
                ':pid': patient_id,
                ':date': cutoff_date
            },
            ScanIndexForward=False,  # Mais recente primeiro
            Limit=20
        )
        
        items = response.get('Items', [])
        
        # Organizar por tipo de evento
        organized_memory = {
            'lab_results': [],
            'appointments': [],
            'decisions': [],
            'alerts': []
        }
        
        for item in items:
            event_type = item.get('event_type', 'unknown')
            if event_type in organized_memory:
                organized_memory[event_type].append(item)
        
        return {
            'status': 'success',
            'patient_id': patient_id,
            'memory': organized_memory,
            'total_records': len(items),
            'date_range': f'Últimos {days_back} dias'
        }
        
    except Exception as e:
        return {
            'status': 'error',
            'message': f'Erro ao acessar memória: {str(e)}',
            'patient_id': patient_id
        }

def save_to_memory(patient_id: str, event_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tool para salvar informações na memória do agente
    
    Args:
        patient_id: ID do paciente
        event_type: Tipo do evento (lab_result, decision, appointment)
        data: Dados a serem salvos
    
    Returns:
        Dict com status da operação
    """
    dynamodb = boto3.resource('dynamodb')
    memory_table = dynamodb.Table('medical-agent-memory')
    
    try:
        # Criar registro de memória
        memory_record = {
            'patient_id': patient_id,
            'record_id': f"{patient_id}_{int(datetime.now().timestamp())}",
            'event_type': event_type,
            'data': data,
            'created_at': datetime.now().isoformat(),
            'ttl': int((datetime.now() + timedelta(days=2555)).timestamp())  # 7 anos
        }
        
        memory_table.put_item(Item=memory_record)
        
        return {
            'status': 'success',
            'message': f'Dados salvos na memória para paciente {patient_id}',
            'record_id': memory_record['record_id']
        }
        
    except Exception as e:
        return {
            'status': 'error',
            'message': f'Erro ao salvar na memória: {str(e)}',
            'patient_id': patient_id
        }