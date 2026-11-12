## End a turn with the desktop app's `wrap_up`

**In the desktop app a turn that ran a command ends with `mcp__ccd_turn__wrap_up`, and a hand-off
block that is due under the rules above goes in the closing message after that call.** The app
folds text written before any tool call, `wrap_up` included, into that call's activity. Write the
block out in full as the last text of the turn, with no tool call after it. Pointing back to a block
written earlier, as in "the handoff is above", sends the user to text the app has folded away.

- **A `wrap_up` without an `ask` returns "nothing is pending".** That message is about the box: the
  user has no decision to make. It has no bearing on whether the session continues, and after a
  landed unit the judgment above still runs.
- **A `wrap_up` with an `ask` ends the turn, and no text can follow it.** Write the answer before
  that call, since a recap or a question about text not yet written leaves the user with nothing to
  read. When a hand-off block is due, call `wrap_up` without an `ask` instead, and put the question
  in the closing message with the block.

**A `start_session` card does not replace the hand-off block.** The model and effort on a card are
capped at this session's model and effort, so a hand-off to a higher tier cannot be written on one,
and the card expires after a week. Where the app also requires a card, propose it alongside the
block.
