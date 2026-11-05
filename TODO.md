# To do

## Needs a machine whose Claude Code goes through an LLM gateway

Check whether the writing-conventions review prompt is read from the prompt cache behind the
gateway. Run this from a checkout of this repo, in a shell where `claude` reaches the gateway:

```bash
e2e/cache-probe.sh "${TMPDIR:-/tmp}/cache-probe"
```

Six lines of `usage` are printed, three for the `system` arm and three for the `prompt` arm. An arm
works when `cache_read_input_tokens` appears on its second and third lines. If
`cache_creation_input_tokens` appears on all three lines of the `system` arm, the cache-write price
is charged on every review there.
Report the six lines in a session here, and clear this item.
