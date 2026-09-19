import { type EntryType, TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";

// Constructed lazily so a missing/blank TYPESAFE_API_KEY surfaces inside
// decideTriage's caller try/catch instead of failing Lambda module init.
let typesafeClient: TypeSafeClient | undefined;
function getClient(): TypeSafeClient {
	if (!typesafeClient) {
		typesafeClient = new TypeSafeClient();
	}
	return typesafeClient;
}

export type Urgency = "urgent" | "priority" | "routine";
export type Specialist =
	| "endocrinologista"
	| "cardiologista"
	| "nefrologista"
	| "generalist";
export type EventType = "alert" | "appointment" | "review";

export interface TriageDecision {
	urgency: Urgency;
	specialist: Specialist;
	event_type: EventType;
	needs_event: boolean;
	reasoning: string;
}

interface TriageInput {
	lab_results?: Record<string, unknown>;
	patient_info?: Record<string, unknown>;
	exam_date?: string;
}

/**
 * Jev is the single decision maker for every triage action: urgency level,
 * specialist assignment, event type, and whether an event is warranted at all.
 */
export async function decideTriage(
	labData: TriageInput,
	history?: unknown,
): Promise<TriageDecision> {
	const state = {
		lab_results: labData.lab_results ?? {},
		patient_info: labData.patient_info ?? {},
		exam_date: labData.exam_date ?? null,
		patient_history: history ?? null,
		// Lab data is already-parsed JSON from S3/EventBridge, so it satisfies JsonValue at runtime.
	} as unknown as EntryType;

	const { answers } = await getClient().systemOne({
		state,
		questions: {
			urgency: choice("What urgency level does this lab result require?", {
				urgent:
					"Immediate action within 0-24h: life-threatening critical values, e.g. glucose >300 or <50 mg/dL, creatinine >3.0 mg/dL.",
				priority:
					"Action within 1-7 days: significant abnormalities, e.g. HbA1c >10%, or multiple critical values.",
				routine: "Normal follow-up within 30-90 days: normal or stable values.",
			}),
			specialist: choice(
				"Which specialist should review this patient's results?",
				{
					endocrinologista:
						"Diabetes, thyroid, hormonal issues (glucose, HbA1c).",
					cardiologista: "Hypertension, cholesterol, cardiac markers.",
					nefrologista: "Creatinine, urea, kidney issues.",
					generalist: "General cases and routine follow-up.",
				},
			),
			event_type: choice(
				"What type of medical event should be created for this case?",
				{
					alert: "Emergency alert requiring immediate attention.",
					appointment: "Scheduled appointment with the recommended specialist.",
					review: "Passive protocol or medication review, not urgent.",
				},
			),
			needs_event: noul(
				"This case requires creating a medical event rather than pure observation.",
				{
					true: "Values are abnormal or trending in a way that requires action.",
					false:
						"Values are normal and stable; no action is needed beyond storing the record.",
				},
			),
		},
	});

	const reasoning =
		`Decisão do Jev (TypeSafe) — urgência: ${answers.urgency.choice} ` +
		`(confiança ${answers.urgency.confidence.toFixed(2)}); especialista: ${answers.specialist.choice} ` +
		`(confiança ${answers.specialist.confidence.toFixed(2)}); tipo de evento: ${answers.event_type.choice} ` +
		`(confiança ${answers.event_type.confidence.toFixed(2)}); probabilidade de necessitar evento: ` +
		`${answers.needs_event.noul.toFixed(2)}.`;

	return {
		urgency: answers.urgency.choice,
		specialist: answers.specialist.choice,
		event_type: answers.event_type.choice,
		needs_event: answers.needs_event.noul >= 0.5,
		reasoning,
	};
}
