# Git & GitHub Command Reference

A practical reference: the commands you'll actually use daily first, then everything else.

---

## Part 1 — Essential Commands

### One-time setup (per machine)

| Command | What it does |
|---|---|
| `git config --global user.name "Your Name"` | Sets the name attached to your commits |
| `git config --global user.email "you@example.com"` | Sets the email attached to your commits |
| `git config --global init.defaultBranch main` | New repos start on `main` instead of `master` |
| `git config --global core.editor "code --wait"` | Use VS Code for commit messages (`--wait` = pause Git until you close the tab) |
| `git config --global core.autocrlf true` | Handles Windows/Unix line-ending differences |
| `git config --list` | Show all current settings |
| `git config <key>` | Show one setting, e.g. `git config core.editor` |

> Blank output from `git config` means the setting is **not set**, not that it failed.
> `git config` is silent on success — no output means it worked.

### Starting a project

| Command | What it does |
|---|---|
| `git init` | Turn the current folder into a Git repo |
| `git clone <url>` | Download an existing repo (sets remote `origin` automatically) |

### The daily loop

```bash
git status                  # what's changed / staged / untracked
git add .                   # stage everything
git commit -m "message"     # save a snapshot
git push                    # send commits to GitHub
git pull                    # bring down others' commits
```

| Command | What it does |
|---|---|
| `git status` | Current state of your working directory |
| `git add <file>` | Stage one file |
| `git add .` | Stage all changes |
| `git commit -m "msg"` | Commit staged changes with a message inline |
| `git commit` | Commit, opening your editor for the message |
| `git log` | Full commit history |
| `git log --oneline` | Compact history, one line per commit |

### Connecting to GitHub (remotes)

| Command | What it does |
|---|---|
| `git remote add <name> <url>` | Link a remote (conventionally named `origin`) |
| `git remote -v` | List remotes and their URLs |
| `git remote set-url <name> <url>` | Change an existing remote's URL |
| `git remote remove <name>` | Unlink a remote |

**Linking is one-time per folder.** Once set, it's saved in `.git/config` permanently. Cloning sets it for you.

```bash
git remote add origin git@github.com:user/repo.git
```

### Pushing and pulling

| Command | What it does |
|---|---|
| `git push -u <remote> <branch>` | First push — also sets **upstream** tracking |
| `git push` | Push again later (upstream already set) |
| `git pull` | Fetch **and** merge remote changes |
| `git fetch` | Download changes **without** touching your files |

**Upstream** = the remote branch your local branch is linked to. Setting it once with `-u` is what lets you type bare `git push` / `git pull` afterwards. Each new branch needs its own `-u` on first push.

```bash
git branch -vv              # see what each branch tracks
```

| Direction | Command | Touches your files? |
|---|---|---|
| local → remote | `push` | — (sends yours) |
| remote → local | `fetch` | No |
| remote → local | `pull` | Yes (fetch + merge) |

### Branches

| Command | What it does |
|---|---|
| `git branch` | List branches, `*` marks current |
| `git branch <name>` | Create a branch |
| `git branch -M <name>` | Rename current branch (e.g. `master` → `main`) |
| `git checkout <name>` | Switch branches |
| `git checkout -b <name>` | Create **and** switch |
| `git switch <name>` | Newer alternative to `checkout` |
| `git merge <name>` | Merge another branch into the current one |
| `git branch -d <name>` | Delete a merged branch |
| `git branch -D <name>` | Force-delete an unmerged branch |

---

## Part 2 — Everything Else

### Undoing things

| Command | What it does |
|---|---|
| `git restore <file>` | Discard uncommitted changes to a file |
| `git restore --staged <file>` | Unstage a file, keep the edits |
| `git reset --soft HEAD~1` | Undo last commit, keep changes staged |
| `git reset --mixed HEAD~1` | Undo last commit, keep changes unstaged |
| `git reset --hard HEAD~1` | Undo last commit, **discard changes** ⚠️ |
| `git revert <commit>` | New commit that undoes an old one (safe for shared history) |
| `git commit --amend` | Edit the most recent commit (message or contents) |
| `git clean -fd` | Delete untracked files and folders ⚠️ |

> Use `revert` on anything already pushed. Use `reset` only on local, unpushed work.

### Inspecting changes

| Command | What it does |
|---|---|
| `git diff` | Unstaged changes vs last commit |
| `git diff --staged` | Staged changes vs last commit |
| `git diff <branch1> <branch2>` | Compare two branches |
| `git show <commit>` | Full details of one commit |
| `git log --graph --oneline --all` | Visual branch history |
| `git log -- <file>` | History of a single file |
| `git blame <file>` | Who last changed each line |

### Stashing (shelve work temporarily)

| Command | What it does |
|---|---|
| `git stash` | Shelve uncommitted changes, clean the working tree |
| `git stash list` | List stashes |
| `git stash pop` | Restore most recent stash and remove it |
| `git stash apply` | Restore but keep it in the stash list |
| `git stash drop` | Delete a stash |

Useful when you need to switch branches mid-task without committing half-done work.

### Tags (marking releases)

| Command | What it does |
|---|---|
| `git tag` | List tags |
| `git tag <name>` | Lightweight tag on current commit |
| `git tag -a <name>` | Annotated tag — opens editor for a message |
| `git push --tags` | Push tags (normal `push` does not send them) |
| `git tag -d <name>` | Delete a local tag |

### Rebasing & history rewriting

| Command | What it does |
|---|---|
| `git rebase <branch>` | Replay your commits on top of another branch |
| `git rebase -i HEAD~3` | Interactive — squash, reword, reorder, drop commits |
| `git cherry-pick <commit>` | Copy one commit onto the current branch |
| `git rebase --abort` | Bail out of a rebase in progress |

> Don't rebase commits you've already pushed to a shared branch.

### Ignoring files

Create a `.gitignore` file in the repo root:

```gitignore
node_modules/
.env
*.log
dist/
.DS_Store
```

| Command | What it does |
|---|---|
| `git rm --cached <file>` | Stop tracking a file already committed (keeps it on disk) |
| `git check-ignore -v <file>` | Explain which rule is ignoring a file |

### Fixing common problems

| Problem | Fix |
|---|---|
| `src refspec main does not match any` | No commit exists yet, or branch is named `master` → commit first, or `git branch -M main` |
| `remote <name> already exists` | `git remote set-url <name> <url>` instead of `add` |
| `Updates were rejected... remote contains work` | `git pull <remote> <branch> --allow-unrelated-histories`, then push |
| `Permission denied (publickey)` | SSH agent forgot your key → re-run `ssh-add ~/.ssh/id_ed25519` |
| Terminal seems frozen after `git log` | You're in the pager — press `q` |

### Commands that open your editor

These all rely on `core.editor`:

- `git commit` (without `-m`)
- `git commit --amend`
- `git rebase -i`
- `git merge` (when a merge commit is needed)
- `git tag -a`
- `git revert`
- `git cherry-pick --edit`

### Useful aliases

```bash
git config --global alias.st status
git config --global alias.cm "commit -m"
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.lg "log --oneline --graph --all"
```

Then `git st`, `git cm "msg"`, `git lg`, etc.

---

## Quick Reference: New Project → GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:user/repo.git
git push -u origin main
```

After that, forever:

```bash
git add .
git commit -m "message"
git push
```
