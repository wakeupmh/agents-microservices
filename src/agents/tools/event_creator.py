import boto3
import json
from datetime import datetime
from typing import Dict, Any

def create_event(event_type: str, patient_id: str, specialist: str, urgency: str, reasoning: str) -> Dict[str, Any]:
    """
    Tool for creating events in EventBridge
    
    Args:
        event_type: Event type (appointment, alert, review)
        patient_id: Patient ID
        specialist: Recommended specialist
        urgency: Urgency level (routine, priority, urgent)
        reasoning: Justification for the decision
    
    Returns:
        Dict with operation status
    """
    eventbridge = boto3.client('events')
    
    try:
        event_detail = {
            'patient_id': patient_id,
            'event_type': event_type,
            'specialist': specialist,
            'urgency': urgency,
            'reasoning': reasoning,
            'created_at': datetime.now().isoformat(),
            'source': 'medical_agent'
        }
        
        detail_type_map = {
            'urgent': 'Medical Emergency Alert',
            'priority': 'Medical Priority Appointment',
            'routine': 'Medical Routine Appointment'
        }
        
        response = eventbridge.put_events(
            Entries=[
                {
                    'Source': 'medical.analysis',
                    'DetailType': detail_type_map.get(urgency, 'Medical General Event'),
                    'Detail': json.dumps(event_detail),
                    'EventBusName': 'default'
                }
            ]
        )
        
        return {
            'status': 'success',
            'message': f'Evento {event_type} criado para paciente {patient_id}',
            'event_id': response['Entries'][0].get('EventId', 'unknown'),
            'specialist': specialist,
            'urgency': urgency
        }
        
    except Exception as e:
        return {
            'status': 'error',
            'message': f'Erro ao criar evento: {str(e)}',
            'event_type': event_type,
            'patient_id': patient_id
        }