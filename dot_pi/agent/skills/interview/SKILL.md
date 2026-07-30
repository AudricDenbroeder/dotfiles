---
name: interview
description: Interview the user using `ask_user_question` tool. Get the information.
---

# interview

## Description
Structured interview process for gathering requirements before producing a plan. Uses the `ask_user_question` tool with guided questions aligned to specific information categories.


## Process

### 1. Elicit goals & users
During the interview, ask questions to understand:

- What is the user's core goal or idea?
- Who are the target users or audience?
- What does success look like for this project?
Use the `ask_user_question` tool with these question categories to guide the conversation.

### 2. Elicit constraints
Ask about practical limitations:
- What is the preferred tech stack or technology constraints?
- Are there timeline, budget, or environment constraints?
- What are the technical dependencies or prerequisites?

Use the `ask_user_question` tool to present constraint-related questions.

### 3. Elicit architecture decisions
Explore existing technical decisions:
- What architecture or design decisions has the user already considered?
- Are there existing codebases or systems this needs to integrate with?
- What are the key technical risks or unknowns?
Use the `ask_user_question` tool for architecture-related questions.

### 4. Validate & summarize back
- Summarize all gathered information back to the user for confirmation
- Ask: "Based on what we've discussed, does this align with your vision?"
- Confirm all requirements are captured correctly

### 5. Handoff protocol
When the interview is complete and the user approves:
- Report that requirements gathering is complete
- Present a summary of what was learned
