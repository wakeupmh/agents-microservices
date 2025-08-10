import "dotenv/config";

interface MedicalEvent {
  patient_id: string;
  event_type: "appointment" | "alert" | "review";
  specialist: string;
  urgency: "routine" | "priority" | "urgent";
  reasoning: string;
  created_at: string;
  source: string;
}

export const handler = async (event: any) => {
  try {
    console.log('Medical event received:', JSON.stringify(event, null, 2));
    
    const medicalEvent: MedicalEvent = event.detail;
    
    if (!medicalEvent) {
      console.error('No medical event data found in EventBridge event');
      return {
        status: 'error',
        message: 'Event data missing'
      };
    }
    
    const { patient_id, event_type, specialist, urgency, reasoning } = medicalEvent;
    
    console.log(`Processing ${event_type} for patient ${patient_id}`);
    console.log(`Specialist: ${specialist}, Urgency: ${urgency}`);
    console.log(`Reasoning: ${reasoning}`);
    
    // Handle different event types
    switch (event_type) {
      case 'appointment':
        await handleAppointment(medicalEvent);
        break;
      case 'alert':
        await handleAlert(medicalEvent);
        break;
      case 'review':
        await handleReview(medicalEvent);
        break;
      default:
        console.warn(`Unknown event type: ${event_type}`);
    }
    
    return {
      status: 'success',
      message: `${event_type} processed successfully for patient ${patient_id}`,
      event_type,
      urgency,
      specialist
    };
    
  } catch (error) {
    console.error('Error processing medical event:', error);
    return {
      status: 'error',
      message: `Error processing event: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
};

async function handleAppointment(event: MedicalEvent) {
  console.log(`📅 APPOINTMENT SCHEDULED`);
  console.log(`Patient: ${event.patient_id}`);
  console.log(`Specialist: ${event.specialist}`);
  console.log(`Urgency: ${event.urgency}`);
  console.log(`Reason: ${event.reasoning}`);
  
  // Here you could integrate with:
  // - Hospital appointment system
  // - SMS/Email notifications
  // - Calendar systems
  // - Patient portal updates
  
  const priority = getAppointmentPriority(event.urgency);
  console.log(`Appointment priority set to: ${priority}`);
  
  // TODO: Add actual appointment booking logic
}

async function handleAlert(event: MedicalEvent) {
  console.log(`🚨 MEDICAL ALERT`);
  console.log(`URGENT: Patient ${event.patient_id} requires immediate attention`);
  console.log(`Specialist needed: ${event.specialist}`);
  console.log(`Alert reason: ${event.reasoning}`);
  
  // Here you could:
  // - Send immediate notifications to on-call doctors
  // - Create emergency appointments
  // - Alert hospital staff
  // - Update patient status to critical
  
  // TODO: Add alert notification logic
}

async function handleReview(event: MedicalEvent) {
  console.log(`📋 MEDICAL REVIEW`);
  console.log(`Patient: ${event.patient_id} needs protocol/medication review`);
  console.log(`Reviewing specialist: ${event.specialist}`);
  console.log(`Review reason: ${event.reasoning}`);
  
  // Here you could:
  // - Schedule medication review appointments
  // - Flag patient charts for review
  // - Notify prescribing physicians
  // - Update treatment protocols
  
  // TODO: Add review scheduling logic
}

function getAppointmentPriority(urgency: string): string {
  switch (urgency) {
    case 'urgent':
      return 'EMERGENCY - Within 24 hours';
    case 'priority':
      return 'HIGH - Within 1-7 days';
    case 'routine':
      return 'NORMAL - Within 30-90 days';
    default:
      return 'NORMAL';
  }
}