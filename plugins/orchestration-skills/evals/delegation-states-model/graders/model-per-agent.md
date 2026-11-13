---
type: llm
---

PASS only if, for every agent the reply proposes to launch, the reply states which model or model tier that agent runs on (a model name such as Sonnet or Opus, or a tier such as "Complex" or "Mechanical"). An agent that is not launched needs no model. Whether an effort level is stated does not change the verdict. FAIL if any agent it launches has no model or tier stated, or if "the default model" or "the session's model" is the only thing said. When failing, quote the launch description that lacks a model.
