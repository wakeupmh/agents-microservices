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
	// Per-answer confidence (0-1) straight from Jev; needs_event uses the raw
	// noul probability rather than the >=0.5 boolean it was thresholded into.
	confidence: {
		urgency: number;
		specialist: number;
		event_type: number;
		needs_event: number;
	};
	reasoning: string;
}

interface TriageInput {
	lab_results?: Record<string, unknown>;
	patient_info?: Record<string, unknown>;
	exam_date?: string;
}

function getNumericLabValue(
	labResults: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const entry = labResults?.[key];
	if (entry && typeof entry === "object" && "value" in entry) {
		const value = (entry as { value?: unknown }).value;
		return typeof value === "number" ? value : undefined;
	}
	return undefined;
}

/**
 * Deterministic backstop for the handful of unambiguously life-threatening
 * values. Used only when the Jev call itself fails (network/API error) —
 * never to second-guess a Jev judgment that came back successfully.
 */
function deterministicCriticalFallback(
	labData: TriageInput,
): TriageDecision | null {
	const glucose = getNumericLabValue(labData.lab_results, "glucose");
	const creatinine = getNumericLabValue(labData.lab_results, "creatinine");

	const certain = { urgency: 1, specialist: 1, event_type: 1, needs_event: 1 };

	if (glucose !== undefined && glucose > 300) {
		return {
			urgency: "urgent",
			specialist: "endocrinologista",
			event_type: "alert",
			needs_event: true,
			confidence: certain,
			reasoning: `Jev indisponível; backstop determinístico ativado: hiperglicemia crítica ${glucose}mg/dL (>300), risco de cetoacidose.`,
		};
	}
	if (glucose !== undefined && glucose < 50) {
		return {
			urgency: "urgent",
			specialist: "endocrinologista",
			event_type: "alert",
			needs_event: true,
			confidence: certain,
			reasoning: `Jev indisponível; backstop determinístico ativado: hipoglicemia severa ${glucose}mg/dL (<50), risco de coma.`,
		};
	}
	if (creatinine !== undefined && creatinine > 3.0) {
		return {
			urgency: "urgent",
			specialist: "nefrologista",
			event_type: "alert",
			needs_event: true,
			confidence: certain,
			reasoning: `Jev indisponível; backstop determinístico ativado: creatinina crítica ${creatinine}mg/dL (>3.0).`,
		};
	}
	return null;
}

/**
 * Jev is the decision maker for every triage action: urgency level,
 * specialist assignment, event type, and whether an event is warranted at
 * all. If the Jev call itself fails, an unambiguously critical value still
 * gets a deterministic alert rather than falling through silently.
 */
export async function decideTriage(
	labData: TriageInput,
	history?: unknown,
): Promise<TriageDecision> {
	try {
		return await runJevTriage(labData, history);
	} catch (error) {
		const fallback = deterministicCriticalFallback(labData);
		if (fallback) {
			console.error(
				"Jev triage call failed; deterministic critical backstop engaged.",
				error,
			);
			return fallback;
		}
		throw error;
	}
}

async function runJevTriage(
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
		confidence: {
			urgency: answers.urgency.confidence,
			specialist: answers.specialist.confidence,
			event_type: answers.event_type.confidence,
			needs_event: answers.needs_event.noul,
		},
		reasoning,
	};
}
