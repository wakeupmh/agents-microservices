import "dotenv/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eventsTool, memoryTool } from "./tools";
import { decideTriage } from "./triage";

const s3Client = new S3Client({
	region: process.env.AWS_REGION || "us-east-1",
});

interface LabData {
	patient_id: string;
	exam_date?: string;
	lab_results?: Record<string, unknown>;
	patient_info?: Record<string, unknown>;
}

interface MemoryRetrieveResult {
	success: boolean;
	records?: unknown[];
}

export const handler = async (event: {
	detail: {
		lab_data?: LabData;
		object?: {
			key: string;
		};
		bucket: {
			name: string;
		};
	};
}) => {
	try {
		console.log("EventBridge event received:", JSON.stringify(event));

		let labData: LabData | null = null;

		if (event.detail?.lab_data) {
			labData = event.detail.lab_data;
		} else if (event.detail?.object) {
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
			console.error("No lab data found in event");
			return {
				status: "error",
				message: "Dados laboratoriais não encontrados no evento",
			};
		}

		const patientId = labData.patient_id;
		if (!patientId) {
			console.error("No patient_id found in lab data");
			return {
				status: "error",
				message: "ID do paciente não encontrado",
			};
		}

		console.log(`Processing lab analysis for patient ${patientId}`);

		const history = (await memoryTool.execute({
			action: "retrieve",
			patient_id: patientId,
		})) as MemoryRetrieveResult;

		// Jev (TypeSafe) is the single decision maker for every triage action:
		// urgency, specialist, event type, and whether an event is warranted at all.
		const decision = await decideTriage(labData, history.records);

		// event_type is the answer that showed run-to-run instability on cases with
		// several simultaneous abnormal values (see local-test's benchmark notes) —
		// exactly when Jev's own confidence dropped below ~0.5. Below that threshold,
		// publish the safer "review" instead of acting on an unstable answer; the
		// stored decision still records what Jev actually said.
		const EVENT_TYPE_CONFIDENCE_THRESHOLD = 0.5;
		const eventType =
			decision.confidence.event_type < EVENT_TYPE_CONFIDENCE_THRESHOLD
				? "review"
				: decision.event_type;

		const storeMemory = memoryTool.execute({
			action: "store",
			patient_id: patientId,
			record_id: `triage_${Date.now()}`,
			data: {
				lab_results: labData.lab_results,
				exam_date: labData.exam_date,
				decision,
			},
		});

		await (decision.needs_event
			? Promise.all([
					storeMemory,
					eventsTool.execute({
						event_type: eventType,
						patient_id: patientId,
						specialist: decision.specialist,
						urgency: decision.urgency,
						reasoning: decision.reasoning,
					}),
				])
			: storeMemory);

		return {
			status: "success",
			patient_id: patientId,
			decision,
			analysis_timestamp: labData.exam_date,
		};
	} catch (error) {
		console.error("Error in medical analysis:", error);
		return {
			status: "error",
			message: `Erro na análise médica: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
};
