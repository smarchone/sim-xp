# sim-xp

**Simulate a blog, an incident or a load test.**

A new way for engineers to share and build experience. Agents turn any blog, incident or concept into a
simulation that brings you closer to reality, and saves you the reading.

```
experience ──encode──▶ playbook.json ──run──▶ simulation
```

**Start playing:** https://smarchone.github.io/sim-xp/v2/ · **About:** https://smarchone.github.io/sim-xp/

## The problem

- There's a gap between reading about a system and experiencing it live.
- Simulations close that gap. Not exact, but much closer.
- Agents make it fast: one story in, one simulation out.

![Load test until it breaks: the three walls of a Kafka cluster](docs/example.png)

## How to create playbooks

The `story-to-playbook` skill turns a blog post, postmortem, concept or short prompt into a validated
`playbook.json`. Install it once:

```sh
npx skills add smarchone/sim-xp --skill story-to-playbook -g
```

Then give it a story in Claude Code:

```
/story-to-playbook https://github.blog/news-insights/company-news/oct21-post-incident-analysis/
/story-to-playbook "Postgres as a job queue, load tested until it breaks"
/story-to-playbook "How a Kafka consumer rebalance storm starts and ends"
```

Open the file in the [player](https://smarchone.github.io/sim-xp/v2/) (drop it on the page, or *Open file…* in
the side panel) and press Space.

## Share your playbook library

A library of playbooks can be hosted as a public Github repo.<br>
eg: [smarchone/simxp-playbooks](https://github.com/smarchone/simxp-playbooks)

Import it in the [player](https://smarchone.github.io/sim-xp/v2/):<br>
`side panel → *Library* → type the repo name → Add`

Can also run a playbook directly via URL eg:<br> `https://smarchone.github.io/sim-xp/v2/#smarchone/simxp-playbooks:postgres-queue-load-test`

Part of [agentic experiences](https://smarchone.github.io/agentic-experiences): accelerate learning with agents.
