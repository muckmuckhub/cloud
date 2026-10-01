# 6. cloud logs: a server's recent lines, then following it live.
Output docs/assets/demos/logs.mp4
Source demos/settings.tape
Set Height 840

Hide
Type "bash /repo/demos/fixtures/up.sh story-added && cd /tmp/cloud-demos/story/mynetwork && PS1='\[\e[2m\]mynetwork\[\e[0m\] $ ' && set +m && clear"
Enter
Wait@600s /\$\s*$/
Show

Type "cloud logs lobby-1 --tail 15"
Sleep 1s
Enter
Sleep 8s

# Something for -f to show arriving: a chat line, sent off camera a few
# seconds after following starts.
Hide
Type `clear && (sleep 9; cloud exec lobby-1 "say A new line arrives while following" >/dev/null) &`
Enter
Type "clear"
Enter
Show
Type "cloud logs lobby-1 -f --tail 5"
Sleep 1s
Enter
Wait+Screen@30s /new line arrives/
Sleep 6s
Ctrl+C
Sleep 3s
