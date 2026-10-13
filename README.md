# bb-plugin-chat-find

Ctrl+F (Cmd+F on macOS) find bar for bb chat transcripts.

- Opens over the chat that holds keyboard focus, or the chat last clicked when
  nothing is focused, falling back to the focused pane's main chat.
- Case-insensitive literal matching; matches across inline formatting and
  syntax-highlighted code, never across paragraphs.
- Enter / Shift+Enter move between matches, Escape closes and restores focus.
- Counts refresh while messages stream in, keeping the active match.
- Also available as **Find in chat** in the quick palette (Mod+Shift+P), which
  can be bound to another shortcut in Settings → Keyboard.

The embedded browser keeps Mod+F for find in page while it has focus;
terminals, Monaco editors, and open dialogs also keep the chord. Collapsed
rows and older messages that have not loaded are not searched.

## Install

```bash
npm install
bb plugin install . --yes
```

After editing, `bb plugin build . && bb plugin reload chat-find`.
