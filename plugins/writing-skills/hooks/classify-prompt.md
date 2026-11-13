The message is the JSON input of a Claude Code hook for a call to an MCP tool: `tool_name` is
`mcp__<server>__<tool>`, and `tool_input` is what the tool is about to be given.

Can this tool hand text to a human-facing destination? Creating or editing an issue, a pull
request, a page, a document, or a file; adding a comment or a review; sending a chat message or an
email; and updating a description, a summary, or a status note all count, whatever the server is.

Reply with one word and nothing else:

- `CAN_PUBLISH` when it can, or when you are not sure. A tool with a free-text field that a person
  will read later is `CAN_PUBLISH` even when that field is empty in this input.
- `NEVER` when the tool only reads (get, list, search, fetch, query, view, download), or when it
  writes nothing a person reads as prose: a transition, a label, an assignee, a reaction, a
  navigation step, a click.

Judge the tool, from its name and the fields of this input. Do not judge the text in the input.
