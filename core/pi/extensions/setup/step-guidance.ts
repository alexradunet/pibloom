/**
 * Step guidance constants for setup.
 * Defines what Pi should say/do at each first-boot setup step.
 */
import type { StepName } from "../../../lib/setup.js";

/** Step guidance — what Pi should say/do at each step. */
export const STEP_GUIDANCE: Record<StepName, string> = {
	persona:
		"Start by briefly explaining how nixPI works: nixPI keeps durable memory in ~/nixPI/, can propose changes to itself through tracked evolutions that require user approval, uses the built-in Matrix stack plus nixpi-daemon to stay available in rooms even after logout, and always runs through one supervisor that uses the default Pi host agent unless valid ~/nixPI/Agents/*/AGENTS.md overlays add more agents. Then guide the user through personalizing their AI companion. Ask one question at a time: SOUL - 'What should I call you?', 'How formal or casual should I be?', 'Any values important to you?'. BODY - 'Same style everywhere, or different for Matrix vs terminal?'. FACULTY - 'Step-by-step thinker or quick and direct?'. Update ~/nixPI/Persona/ files with their preferences. Fully skippable.",
};
