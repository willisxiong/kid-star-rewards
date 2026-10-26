# Product brief — Kid Star Rewards

## Purpose

Kid Star Rewards turns everyday habits into a simple star economy: children get immediate feedback for completing tasks, and parents keep final say over anything that costs stars. The goal is low friction for kids and clear oversight for parents—not gamification for its own sake.

## Users and roles

### Child (kid view)

The child experience should feel encouraging and readable at a glance:

1. **Balance** — “How many stars do I have right now?”
2. **Tasks** — repeatable check-ins (e.g. hygiene, meals, tidying, homework) with fixed star values set by defaults or parents.
3. **Wishlist** — rewards with visible progress; redeeming creates a **request**, not an instant payout.

Redemption is intentionally **two-step**: the child taps redeem; the parent must approve before stars are spent and the reward is “granted.”

### Parent (parent view)

The parent experience is administrative and audit-friendly:

1. **Queue** — pending redemption requests with approve / reject.
2. **Catalog management** — add tasks and rewards without redeploying the app.
3. **Log** — a short rolling history (on the order of the last ~8 events) for “what changed and when.”

## Core flows

### Earn stars (check-in)

```
Child taps "Check in" on a task → stars added to balance → log entry
```

Prototype behavior did not enforce “once per day” per task; MVP should define whether check-ins are unlimited, once per calendar day, or parent-configurable.

### Redeem reward (approval loop)

```
Child taps "Redeem" (if balance ≥ cost) → request enters parent queue (stars may be held or reserved — TBD in implementation)
Parent approves → stars deducted, reward marked fulfilled, log entry
Parent rejects → request cleared, balance restored if held, log entry
```

### Customize catalog

```
Parent enters task name + stars (1–100) → task appears on kid task grid
Parent enters reward name + cost (1–500) → reward appears on wishlist
```

Validation ranges come from the prototype spec; adjust in implementation if usability testing suggests different caps.

## Default content (prototype reference)

**Tasks (examples)**

| Task | Stars |
|------|-------|
| Brush teeth independently | +2 |
| Eat independently | +2 |
| Tidy room | +3 |
| Finish homework | +5 |

**Rewards (examples)**

| Reward | Cost |
|--------|------|
| Listen to a story | 5 |
| Ice cream | 10 |
| One cartoon episode | 15 |
| Buy a toy | 50 |

Parents can add more; defaults seed the first-run experience.

## Out of scope for MVP

- Multiple children per household
- Push notifications or email
- User accounts and cross-device sync (unless MVP explicitly chooses a minimal auth story)
- Automatic daily reset of task check-ins (can follow persistence MVP)
- Social features, leaderboards, or external integrations

## Non-goals

- Replacing parental judgment with automated enforcement
- Complex point economies (tiers, expiring stars, etc.) before the single-child loop works well

## Success criteria (MVP)

- A family can use the app across refreshes without losing balance, tasks, rewards, or pending requests.
- A child can check in and request a redemption; a parent can approve or reject with correct star math.
- Operation log reflects earns, redemptions, and catalog changes clearly enough to settle “what happened?” disputes.

## Open questions (for issues)

- Hold stars on redeem vs deduct only on approve
- Per-task daily limits and timezone for “daily”
- Storage: local-first (PWA) vs small backend
- Localization (prototype UI was Chinese; product docs are English-first)
