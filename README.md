# Kid Star Rewards

A family habit and reward app that helps children build daily routines while giving parents control over approvals and customization.

Kids earn **stars** by completing chores and habits, then spend those stars on wishlist rewards. Parents review redemption requests, manage tasks and rewards, and see a short history of what happened in the app.

## Kid vs parent roles

| Role | What they do |
|------|----------------|
| **Kid** | See star balance, check in on daily tasks, browse the wishlist, and request redemptions (pending parent approval). |
| **Parent** | Approve or reject redemption requests, add custom tasks and rewards, and read the operation log. |

## Features

### Kid view

- **Star balance** — current available points.
- **Daily check-in tasks** — tap to check in and earn stars (example defaults: brush teeth +2, eat independently +2, tidy room +3, finish homework +5).
- **Reward wishlist** — each reward shows required stars, a progress bar toward the goal, and **Redeem** when affordable; redemption stays **pending** until a parent acts.

### Parent view

- **Pending redemption requests** — approve (stars deducted) or reject (no deduction / refund if already held).
- **Custom tasks** — name + star reward (planned range: 1–100 stars).
- **Custom rewards** — name + star cost (planned range: 1–500 stars).
- **Operation log** — recent activity (prototype showed ~last 8 events).

### Prototype note

An early [Gemini Canvas](https://gemini.google.com/) demo validated the UX with **in-memory state only**: no accounts, no persistence, and no automatic daily task reset. This repository documents the product direction; implementation is not started here yet.

## Planned MVP scope

The first shipped version is intentionally small:

- **Single family, single child**
- **Persistence** across browser refresh (local or simple backend — TBD)
- **Parent approval loop** for redemptions
- **Later** (post-MVP): multiple children, push notifications, accounts/sync, daily reset rules

## Repository status

**Early / docs-first.** There is no runnable app in this repo yet. Use issues to discuss scope, tech choices, and milestones before code lands.

## Contributing

1. Open an issue to describe bugs, ideas, or MVP tasks.
2. For larger changes, comment on an issue first so approach aligns with MVP goals.
3. Pull requests are welcome once implementation begins; until then, PRs that improve docs or product clarity are especially helpful.

## Project docs

- [Product brief](docs/PRODUCT.md) — roles, flows, and MVP boundaries in more detail.

## Name and repo

- **Product name:** Kid Star Rewards  
- **GitHub repo:** [kid-star-rewards](https://github.com/kid-star-rewards/kid-star-rewards) (adjust URL if your org/user differs)
