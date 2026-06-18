# deep-analyst plugin

An OpenHands Agent SDK plugin that bundles the multi-agent research pipeline
used by Deep Analyst.

## Structure

```
deep-analyst-plugin/
├── .plugin/
│   └── plugin.json        # plugin manifest (name, version, description, author)
├── agents/                # agent definitions (markdown + YAML frontmatter)
│   ├── lead-analyst.md     # orchestrator — decomposes query, may ask_user
│   ├── web-researcher.md   # parallel researcher — web_search + write_file
│   ├── data-analyst.md     # extracts metrics from notes — write_file
│   └── report-writer.md    # synthesises the final brief — write_file
├── .mcp.json              # MCP servers (none — tools are registered in Python)
└── README.md
```

## How it's loaded

The backend loads this plugin with the SDK's `Plugin.load()`:

```python
from openhands.sdk.plugin import Plugin

plugin = Plugin.load("deep-analyst-plugin")
agents = {d.name: d for d in plugin.agents}   # AgentDefinition per stage
```

Each `AgentDefinition` carries its system prompt (the markdown body) and its
allowed `tools` list. The pipeline orchestrator (`app/openhands_runner.py`)
builds one SDK `Agent` per stage from these definitions and runs each as a
`Conversation`.

## Tools

The agents reference three custom tools — `web_search`, `write_file`, and
`ask_user`. These are Python `ToolDefinition` classes registered globally with
`register_tool()` in `app/openhands_runner.py` (plugins bundle agents, skills,
hooks and MCP config — not Python tool classes), so the tool names in each
agent's frontmatter resolve at agent-construction time.
