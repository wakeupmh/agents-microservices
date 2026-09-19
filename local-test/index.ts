import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Urgency, decideTriage } from "../src/triage";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LabDataFixture {
	patient_id?: string;
	exam_date?: string;
	lab_results?: Record<string, unknown>;
	patient_info?: Record<string, unknown>;
}

interface FixtureCase {
	file: string;
	description: string;
	// Only set for fixtures that are unambiguous per the thresholds Jev
	// itself is given (see the urgency choice descriptions in
	// src/triage.ts). Left undefined for genuinely borderline cases.
	expectedUrgency?: Urgency;
}

const FIXTURES: FixtureCase[] = [
	{
		file: "normal_glucose.json",
		description: "Normal glucose levels",
		expectedUrgency: "routine",
	},
	{
		file: "high_glucose.json",
		description: "High (non-critical) glucose",
	},
	{
		file: "critical_high_glucose.json",
		description: "Critical high glucose (>300 mg/dL)",
		expectedUrgency: "urgent",
	},
	{
		file: "critical_low_glucose.json",
		description: "Critical low glucose (<50 mg/dL)",
		expectedUrgency: "urgent",
	},
	{
		file: "sample-patient-data.json",
		description: "General patient data sample (multiple abnormal values)",
	},
];

function loadFixture(file: string): LabDataFixture {
	const raw = readFileSync(join(__dirname, file), "utf-8");
	return JSON.parse(raw) as LabDataFixture;
}

async function runFixture(fixture: FixtureCase): Promise<boolean> {
	const labData = loadFixture(fixture.file);
	console.log(`\n=== ${fixture.file} — ${fixture.description} ===`);
	console.log(`patient_id: ${labData.patient_id ?? "(missing)"}`);

	try {
		// No patient history is passed: this checks Jev's judgment on each
		// fixture in isolation, not the DynamoDB-backed continuity path. It
		// never touches memoryTool/eventsTool, so no AWS credentials are
		// needed — use test-invoke.sh or test-s3.sh for the full handler.
		const decision = await decideTriage(labData);

		console.log(`urgency: ${decision.urgency}`);
		console.log(`specialist: ${decision.specialist}`);
		console.log(`event_type: ${decision.event_type}`);
		console.log(`needs_event: ${decision.needs_event}`);
		console.log(`reasoning: ${decision.reasoning}`);

		if (decision.reasoning.startsWith("Jev indisponível")) {
			console.warn(
				"WARN: deterministic backstop engaged instead of a live Jev call — check TYPESAFE_API_KEY.",
			);
		}

		if (
			fixture.expectedUrgency &&
			decision.urgency !== fixture.expectedUrgency
		) {
			console.error(
				`FAIL: expected urgency "${fixture.expectedUrgency}", got "${decision.urgency}"`,
			);
			return false;
		}

		console.log("PASS");
		return true;
	} catch (error) {
		console.error(
			`ERROR: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		return false;
	}
}

async function main() {
	console.log(
		"Running Jev triage against local-test fixtures (decideTriage from src/triage.ts)...",
	);

	let allPassed = true;
	for (const fixture of FIXTURES) {
		const passed = await runFixture(fixture);
		allPassed = allPassed && passed;
	}

	console.log(
		`\n${allPassed ? "All fixtures passed." : "Some fixtures failed — see FAIL/ERROR above."}`,
	);
	if (!allPassed) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error("Unexpected error running local-test fixtures:", error);
	process.exitCode = 1;
});
