# 2. A mistake in that same file: caught when it is read, before anything
# starts, with what to do about it. Embedded under `cloud apply`.
Output docs/assets/demos/validate.mp4
Source demos/settings.tape

Hide
Type "bash /repo/demos/fixtures/fresh.sh story-init"
Enter
Type "cd /tmp/cloud-demos/story/mynetwork && PS1='\[\e[2m\]mynetwork\[\e[0m\] $ ' && set +m && clear"
Enter
Show

Type "# Switch the proxy to BungeeCord, but leave forwarding on modern:"
Sleep 1s
Enter
Sleep 2s
Type `sed -i 's/software = "velocity"/software = "bungeecord"/' cloud.toml`
Sleep 1.5s
Enter
Sleep 2s

Type "cloud apply"
Sleep 1s
Enter
Wait+Screen@20s /invalid/
Sleep 14s
