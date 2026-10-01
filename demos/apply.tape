# 3. cloud apply: preview with --dry-run, then the file from `cloud init` becomes
# a running network. Leaves it running for the demos after it.
Output docs/assets/demos/apply.mp4
Source demos/settings.tape
Set Height 840

Hide
Type "bash /repo/demos/fixtures/fresh.sh story-init"
Enter
Type "cd /tmp/cloud-demos/story/mynetwork && PS1='\[\e[2m\]mynetwork\[\e[0m\] $ ' && set +m && clear"
Enter
Show

Type "cat cloud.toml"
Sleep 1s
Enter
Sleep 8s

Hide
Type "clear"
Enter
Show
Type "cloud apply --dry-run"
Sleep 1s
Enter
Wait+Screen@30s /stopping before writing/
Sleep 8s

Hide
Type "clear"
Enter
Show
Type "cloud apply"
Sleep 1s
Enter
Wait@30s /reconcile\?/
Sleep 4s
Type "y"
Sleep 600ms
Enter
Wait+Screen@120s /network is up/
Sleep 9s
