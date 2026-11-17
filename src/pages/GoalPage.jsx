import { CreateCoursePage, readGoalDraft } from "./CreateCoursePage.jsx";

// Re-export CreateCoursePage as GoalPage for complete backward compatibility
const GoalPage = CreateCoursePage;

export { GoalPage, CreateCoursePage, readGoalDraft };
