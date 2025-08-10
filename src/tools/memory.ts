import { createTool } from "@voltagent/core";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || "medical-agent-memory";

/**
 * A tool for storing and retrieving medical patient records from DynamoDB
 */
export const memoryTool = createTool({
  name: "memory",
  description: "Store or retrieve medical patient records from memory",
  parameters: z.object({
    action: z.enum(["store", "retrieve"]).describe("Whether to store or retrieve a record"),
    patient_id: z.string().describe("The patient identifier"),
    record_id: z.string().optional().describe("The record identifier (required for store, optional for retrieve)"),
    data: z.any().optional().describe("The medical data to store (required for store action)"),
  }),
  execute: async ({ action, patient_id, record_id, data }) => {
    try {
      if (action === "store") {
        if (!record_id || !data) {
          throw new Error("record_id and data are required for store action");
        }

        const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days TTL
        
        const command = new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            patient_id,
            record_id,
            data,
            ttl,
            created_at: new Date().toISOString(),
          },
        });

        await docClient.send(command);
        
        return {
          success: true,
          message: `Successfully stored record ${record_id} for patient ${patient_id}`,
        };
      } else if (action === "retrieve") {
        const command = new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "patient_id = :patient_id",
          ExpressionAttributeValues: {
            ":patient_id": patient_id,
          },
          ...(record_id && {
            FilterExpression: "record_id = :record_id",
            ExpressionAttributeValues: {
              ":patient_id": patient_id,
              ":record_id": record_id,
            },
          }),
        });

        const result = await docClient.send(command);
        
        return {
          success: true,
          records: result.Items || [],
          count: result.Count || 0,
          message: `Found ${result.Count || 0} record(s) for patient ${patient_id}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        message: `Failed to ${action} record for patient ${patient_id}`,
      };
    }
  },
});