# NexusAi Autonomous Campaign Operator

## Product goal
Make the AI Operator the primary way customers use NexusAi.

A customer can enter a short brief such as:

> “I sell contact-center solutions.”

The Operator then asks only for essential missing constraints, researches the market, designs multiple campaign plays, finds suitable leads in the existing database, estimates calling capacity, and presents a complete execution plan. Nothing launches until the customer approves that plan. After approval, it prepares and runs the campaign using the customer’s connected sending/calling accounts and continuously monitors results with one objective: produce qualified booked meetings.

The product will describe this as optimization toward meetings—not promise that every campaign will be a winner, because market response cannot be guaranteed.

## 1. Guided campaign brief
- Add a dedicated **AI Operator** tab with persistent threaded conversations at `/app/operator/:threadId`.
- Accept a minimal offer description, then intelligently ask only for missing essentials such as website, geography, ideal deal size, exclusions, caller count, available calling hours, meeting definition, and risk limits.
- Ask for caller count and capacity during setup; do not infer a team structure because organizations and multi-user teams remain deferred.
- Let the customer attach the offer to existing Product Info and connected customer-owned accounts. Never use developer/shared sending, calendar, or calling credentials.

## 2. Evidence-backed strategy research
- Give the Operator a server-side web-research capability using a connected research provider, with citations saved alongside its conclusions.
- Research the customer’s website, market, buyer roles, pain points, competitor positioning, current credible outreach guidance, timing considerations, compliance constraints, and channel tactics.
- Prefer recent, reputable primary or industry sources; show source dates and links, distinguish evidence from assumptions, and avoid treating generic blog claims as universal facts.
- Combine web evidence with live NexusAi data rather than blindly applying “best time to email” rules. Once real campaign results exist, the customer’s own performance becomes the strongest optimization signal.

## 3. Full campaign map before approval
The Operator produces a reviewable campaign blueprint containing:
- Offer interpretation, value proposition, likely pains, proof points, objections, and missing information.
- Several distinct campaign plays instead of one broad audience—for example smaller-company operations leaders, contact-center directors, and another evidence-supported segment.
- For each play: ICP filters, exclusions, estimated database audience, lead-score criteria, geography, channels, sequence structure, messaging angle, CTA, and expected learning objective.
- Lead allocation and deduplication across plays so prospects are not contacted by competing campaigns.
- Email-validation policy and suppression rules.
- Daily email volume, ramp schedule, send windows, follow-up spacing, mailbox allocation, and safety limits based on the customer’s connected accounts—not arbitrary global limits.
- Calling plan based on caller count, hours, realistic call capacity, prioritized queues, scripts, voicemail use, follow-up actions, and daily rep objectives.
- Meeting-booking path, calendar readiness, reply handling, positive-reply escalation, and handoff rules.
- Budget/credit estimate, expected setup time, dependencies, risks, compliance notes, and the exact changes the Operator intends to make.
- Clear success metrics, guardrails, review cadence, stop-loss criteria, and what the Operator may optimize automatically after approval.

The UI shows this as an editable summary with source citations and an **Approve & build** action. The customer can change any section before approval.

## 4. One comprehensive authorization with hard guardrails
- Approving the full plan authorizes the Operator to create the specified draft campaigns, find/score leads, add them to the proper campaigns, validate emails, generate personalized sequences and call scripts, configure schedules, and launch when every readiness check passes.
- The approval records a versioned snapshot of targets, volumes, budgets, channels, connected accounts, and optimization boundaries.
- Within those approved limits, the Operator may perform reversible routine optimizations without repeatedly interrupting the user.
- It must request a new approval before exceeding spend/volume limits, adding a new audience or channel, materially changing positioning, replacing connected accounts, deleting data, or taking another high-impact action outside the approved blueprint.
- Pause controls remain available globally and per campaign. Existing launch safety checks for mailbox setup, verified addresses, generated content, campaign ownership, and prospect limits remain mandatory.

## 5. Visible execution timeline
- Show every operation as it happens: researching, querying the lead database, estimating audience size, scoring, validating, creating campaign plays, generating emails/scripts, configuring schedules, launching, monitoring, and optimizing.
- Each operation displays status, counts, reason, source/evidence, resulting record links, errors, retries, and whether it was automatic or approval-gated.
- Use resumable background jobs rather than a browser tab that must stay open.
- Make partial failures understandable and recoverable; the Operator must never silently skip leads or claim completion when a job is incomplete.

## 6. Always-on campaign control loop
- Add persisted operator runs, tasks, checkpoints, observations, recommendations, approvals, and action history.
- Run scheduled monitoring in the background so the system continues when the user is offline.
- Analyze campaign readiness and delivery, validation quality, send failures, replies, reply sentiment, calls, call outcomes, scorecards, meetings, segment performance, and lead quality.
- Produce a daily executive brief covering wins, risks, anomalies, work completed, work planned, campaign health, and prioritized caller objectives.
- Optimize only when sample size and evidence justify it. The Operator should prefer controlled experiments—such as changing one subject-line or audience variable—over rewriting everything after a few results.
- Automatically perform approved reversible actions such as reprioritizing call queues, pausing an unhealthy play, adjusting allocation inside approved limits, or proposing a controlled message test.
- Keep a permanent decision log explaining what changed, why, what evidence supported it, and whether it improved booked-meeting performance.

## 7. Professional marketer intelligence
The system prompt and operating policy will require the Operator to:
- Think like a senior B2B demand-generation strategist and sales-operations leader, not a generic chatbot.
- Optimize the whole funnel: audience quality → deliverability → engagement → conversations → qualified meetings.
- Use distinct segment hypotheses, disciplined experimentation, realistic capacity planning, and conservative deliverability practices.
- Challenge weak offers or poor targeting rather than manufacturing false confidence.
- Ask for clarification only when the missing answer materially affects execution; otherwise state a reasonable assumption in the plan.
- Never fabricate research, performance, intent, or attribution.

## 8. Cost-controlled model strategy
- Use a strong reasoning model for initial offer analysis, market strategy, campaign architecture, major optimization decisions, and executive diagnosis.
- Use a fast, lower-cost model for high-volume scoring, classification, summarization, lead routing, status monitoring, and routine daily work.
- Start with a quality/cost-balanced Lovable AI model mix rather than the most expensive model for every operation.
- Track AI usage by operator run and expose an estimated/actual cost summary so customers can understand the tradeoff.
- Keep prompts and tool outputs compact, reuse persisted research, and avoid paying repeatedly to rediscover unchanged information.

## 9. Persistent chat and operator UI
- Store user-owned threads and complete AI SDK `UIMessage` history in Lovable Cloud with row-level access controls.
- Use AI Elements for streamed markdown, prompt input, thinking states, tool execution, approval cards, and errors.
- Restore the exact thread from its URL after refresh and prevent message history from crossing threads.
- Render the campaign blueprint as a structured command-center view beside the conversation, with campaign links, progress, approvals, citations, daily briefs, and the execution timeline.
- Use a domain-specific Operator identity rather than a generic sparkle icon, while preserving the existing Aurora Glass design system.

## 10. Data and server architecture
- Add user-scoped tables for operator threads/messages, campaign blueprints and versions, approvals, runs/tasks/events, research sources, daily briefs, and optimization decisions.
- Add explicit grants, row-level policies, timestamps, ownership checks, and indexes for every new table.
- Use TanStack server functions for authenticated reads/mutations and a TanStack streaming route for chat.
- Use the AI SDK tool loop with typed schemas; mutation tools require approval or verify that the requested action is inside an approved blueprint.
- Persist completed assistant messages in the stream’s `onFinish` handler and surface persistence failures.
- Implement background scheduling through secured server jobs; no customer must leave the Operator page open for monitoring to continue.

## 11. First release boundaries
Included:
- Offer-to-blueprint flow.
- Cited strategy research.
- Multiple campaign plays.
- Database lead discovery, scoring, validation, campaign creation, email/calling preparation, launch, monitoring, daily briefs, and guarded optimization.
- Single signed-in account with caller capacity entered during setup.

Deferred:
- Voice/Jarvis interaction.
- Organization/team membership, manager-to-rep assignments, per-seat objectives, and cross-rep comparisons.
- Purchasing email accounts inside NexusAi.
- Unbounded autonomous spending or outreach beyond the approved blueprint.

## 12. Validation
- Create a blueprint from a minimal “contact-center solutions” brief and confirm it identifies missing constraints without requiring a long form.
- Confirm the blueprint includes multiple non-overlapping campaign plays, cited research, send/call capacity, budget, guardrails, and exact proposed actions.
- Confirm no leads are validated, credits spent, campaigns created, or outreach launched before approval.
- Approve the blueprint and verify the complete execution pipeline, visible timeline, retries, and ownership boundaries.
- Verify the background monitor continues after leaving the page, creates a real-data daily brief, and stays within approved limits.
- Verify at least two threads retain isolated histories after refresh.
- Verify global/per-campaign pause controls stop pending operator work safely.
- Run the full build/lint checks and test desktop and responsive Operator flows.