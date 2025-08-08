import json
import boto3
from datetime import datetime, timedelta
from typing import Dict, Any


def create_appointment(event: Dict[str, Any], _context) -> str:
    """
    Simple appointment creation handler for medical events
    """
    try:
        detail = event.get('detail', {})
        
        patient_id = detail.get('patient_id')
        specialist = detail.get('specialist')
        urgency = detail.get('urgency')
        reasoning = detail.get('reasoning')
        
        if not all([patient_id, specialist, urgency]):
            return json.dumps({
                'status': 'error',
                'message': 'Missing required fields: patient_id, specialist, or urgency'
            })
        
        now = datetime.now()
        if urgency == 'urgent':
            appointment_date = now + timedelta(hours=2)
        elif urgency == 'priority':
            appointment_date = now + timedelta(days=3)
        else:  # routine
            appointment_date = now + timedelta(days=30)
        
        appointment_id = f"APT-{patient_id}-{int(now.timestamp())}"
        
        print(f"Creating appointment: {appointment_id}")
        print(f"Patient: {patient_id}")
        print(f"Specialist: {specialist}")
        print(f"Urgency: {urgency}")
        print(f"Scheduled: {appointment_date.isoformat()}")
        print(f"Reason: {reasoning}")
        
        # In a real implementation, you would:
        # 1. Call hospital scheduling system API
        # 2. Send notifications to patient/staff
        # 3. Update patient management system
        # 4. Create calendar entries
        
        # Simulate appointment booking
        appointment_result = {
            'appointment_id': appointment_id,
            'patient_id': patient_id,
            'specialist': specialist,
            'urgency': urgency,
            'scheduled_date': appointment_date.isoformat(),
            'reasoning': reasoning,
            'status': 'scheduled',
            'created_at': now.isoformat()
        }
        

        save_appointment_to_db(appointment_result)
        
        return json.dumps({
            'status': 'success',
            'message': f'Appointment created successfully',
            'appointment': appointment_result
        })
        
    except Exception as e:
        return json.dumps({
            'status': 'error',
            'message': f'Error creating appointment: {str(e)}',
            'patient_id': detail.get('patient_id', 'unknown')
        })


def save_appointment_to_db(appointment_data: Dict[str, Any]):
    """
    Optional: Save appointment to DynamoDB for tracking
    """
    try:
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table('medical-agent-memory')
        
        record = {
            'patient_id': appointment_data['patient_id'],
            'record_id': f"appointment_{appointment_data['appointment_id']}",
            'event_type': 'appointment_created',
            'data': appointment_data,
            'created_at': datetime.now().isoformat(),
            'ttl': int((datetime.now() + timedelta(days=365)).timestamp())  # 1 year
        }
        
        table.put_item(Item=record)
        print(f"Appointment saved to database: {appointment_data['appointment_id']}")
        
    except Exception as e:
        print(f"Error saving appointment to DB: {str(e)}")
        # Don't fail the main function if DB save fails