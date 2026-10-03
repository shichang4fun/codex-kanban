#!/bin/sh
# Download the marketplace ZIP, extract it, and double-click this file.
TASK_APP='/Applications/ChatGPT.app'
TASK_NODE="$TASK_APP/Contents/Resources/cua_node/bin/node"
TASK_PACKAGE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/plugins/codex-kanban"
if [ ! -x "$TASK_NODE" ]; then
  echo 'Install the current ChatGPT desktop app with Codex at /Applications/ChatGPT.app first.' >&2
  TASK_STATUS=1
elif [ ! -r "$TASK_PACKAGE/install.mjs" ]; then
  echo 'Extract the complete marketplace ZIP before running this installer.' >&2
  TASK_STATUS=1
else
  "$TASK_NODE" "$TASK_PACKAGE/install.mjs" --launch
  TASK_STATUS=$?
fi
if [ -t 0 ]; then
  printf '\nPress Return to close this window. '
  read -r TASK_REPLY
fi
exit "$TASK_STATUS"
