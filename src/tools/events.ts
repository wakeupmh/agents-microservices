import { createTool } from "@voltagent/core";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { z } from "zod";

const eventBridgeClient = new EventBridgeClient({
  region: process.env.AWS_REGION || "us-east-1",
});

/**
 * Tool for creating events in EventBridge for medical workflows
 */
export const eventsTool = createTool({
  name: "createEvent",
  description: "Create medical events in EventBridge for appointments, alerts, and reviews",
  parameters: z.object({
    event_type: z.enum(["appointment", "alert", "review"]).describe("Type of medical event to create"),
    patient_id: z.string().describe("Patient identifier"),
    specialist: z.string().describe("Recommended specialist for the patient"),
    urgency: z.enum(["routine", "priority", "urgent"]).describe("Urgency level of the event"),
    reasoning: z.string().describe("Justification for the decision and recommendation"),
  }),
  execute: async ({ event_type, patient_id, specialist, urgency, reasoning }) => {
    try {
      const event_detail = {
        patient_id,
        event_type,
        specialist,
        urgency,
        reasoning,
        created_at: new Date().toISOString(),
        source: 'medical_agent'
      };
      
      const detail_type_map = {
        'urgent': 'Medical Emergency Alert',
        'priority': 'Medical Priority Appointment', 
        'routine': 'Medical Routine Appointment'
      };
      
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: 'medical.analysis',
            DetailType: detail_type_map[urgency],
            Detail: JSON.stringify(event_detail),
            EventBusName: 'default'
          }
        ]
      });
      
      const response = await eventBridgeClient.send(command);
      
      return {
        status: 'success',
        message: `Event ${event_type} created for patient ${patient_id}`,
        event_id: response.Entries?.[0]?.EventId || 'unknown',
        specialist,
        urgency,
        event_type
      };
      
    } catch (error) {
      return {
        status: 'error',
        message: `Failed to create event: ${error instanceof Error ? error.message : 'Unknown error'}`,
        event_type,
        patient_id
      };
    }
  },
});