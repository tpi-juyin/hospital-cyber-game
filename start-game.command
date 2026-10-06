#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [ -x "runtime/node" ]; then
  "./runtime/node" scripts/launch.mjs "$@"
else
  node scripts/launch.mjs "$@"
fi
result=$?
if [ "$result" -ne 0 ]; then
  printf '\n啟動未完成，請查看上方訊息。按 Enter 關閉。\n'
  read -r reply
fi
exit "$result"
