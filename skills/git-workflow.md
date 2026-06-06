# Skill: Git Workflow

When the user asks you to work with git repos, follow this workflow using `run_command`:

## Clone
```
run_command({ command: "git clone https://TOKEN@github.com/USER/REPO.git", cwd: "/tmp" })
```

## Create/Write Files
Use heredoc to write file content:
```
run_command({ command: "cat > path/to/file.tsx << 'ASPEN_EOF'\n...file content...\nASPEN_EOF" })
```

## Commit and Push
Always do the full cycle — never ask the user to do it:
```
run_command({ command: "cd REPO && git add -A && git commit -m 'description' && git push origin main" })
```

## Key Rules
- NEVER tell the user to run terminal commands — use run_command yourself
- NEVER say "I cannot execute commands" — you CAN via run_command
- Always write files to disk THEN commit — don't just show code in chat
- Use the PAT/token the user provided for auth
- Set git config before committing: `git config user.email "..." && git config user.name "..."`
