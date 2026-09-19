# Running a Google Colab Notebook While Your Computer Is Off

A "virtual space" is just a computer that lives in Google's data centers instead of on your desk. Google's official name for it is a **Virtual Machine (VM)**, and the product that rents them out is called **Compute Engine**. Once you start one, it keeps running whether your laptop is on, asleep, or completely powered off — because it isn't your laptop doing the work anymore.

This guide walks you through renting one of these VMs and pointing your Colab notebook at it, so your code keeps executing after you close the lid.

---

## What You'll Need

- A **Google account** (the same one you use for Colab/Gmail).
- A **Google Cloud account with billing enabled**. Google gives new accounts free trial credit, and a small VM costs only cents per hour — but you do need to enter a credit card to turn billing on.
- The **Colab notebook** you want to run.
- About **20–30 minutes** for the one-time setup.
- No prior sysadmin experience needed — every command below is copy-paste.

---

## Part 1: The Big Picture

Normally, when you open a Colab notebook, Google *already* gives you a temporary virtual machine behind the scenes for free. The catch: that machine belongs to Google, is shared, and gets recycled once your browser disconnects for too long (closing your laptop counts). That's why your notebook dies when you shut the lid.

The fix is to rent your **own personal VM** that only you control, put a small notebook server (Jupyter) on it, and tell the Colab website to talk to *that* machine instead of Google's temporary one. The flow looks like this:

1. Create your own VM in Google Cloud.
2. Install Jupyter (a notebook server) on it.
3. Tell Colab, in your browser, to "Connect to local runtime" — pointing at your VM.
4. Press Run. From this point, the VM does the work. Your laptop was only ever a remote control — you can now close it.

---

## Part 2: Step-by-Step Setup

### Step 1 — Create a Google Cloud project
1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Click the project dropdown (top left) → **New Project** → give it a name → **Create**.
3. Make sure a billing account is linked (Console will prompt you if it isn't).

### Step 2 — Create your Virtual Machine
1. In the search bar, type **Compute Engine** and open it (this activates the service the first time).
2. Click **Create Instance**.
3. Reasonable starting settings:
   - **Name:** `colab-vm`
   - **Region/Zone:** pick one close to you
   - **Machine type:** `e2-medium` (cheap, fine for most notebooks; upgrade later if you need more RAM/GPU)
   - **Boot disk:** Ubuntu (latest LTS)
4. Click **Create**. Your VM boots in under a minute.

### Step 3 — Open a terminal on your VM
No extra software needed: in the VM instances list, click the **SSH** button next to your VM. This opens a terminal straight in your browser, connected to the VM.

### Step 4 — Install Jupyter and the Colab connector
In that terminal, run:

```bash
sudo apt update
sudo apt install -y python3-pip
pip3 install jupyter jupyter_http_over_ws
jupyter serverextension enable --py jupyter_http_over_ws
```

### Step 5 — Start the notebook server (and keep it alive)
Start a `tmux` session first, so the server survives you closing this terminal window:

```bash
sudo apt install -y tmux
tmux new -s notebook
```

Inside that session, start Jupyter:

```bash
jupyter notebook \
  --NotebookApp.allow_origin='https://colab.research.google.com' \
  --port=8888 \
  --NotebookApp.port_retries=0
```

Jupyter will print a URL containing a security token, like:
`http://localhost:8888/?token=abcd1234...`
**Copy this — you'll need it in Step 7.**

Detach from `tmux` (so the server keeps running in the background) by pressing `Ctrl+b` then `d`.

### Step 6 — Install the Google Cloud CLI on your own computer
This lets you open a secure tunnel to the VM. Install it from Google's [official instructions](https://cloud.google.com/sdk/docs/install), then run:

```bash
gcloud init
```
and follow the prompts to log in and select your project.

### Step 7 — Tunnel from your computer to the VM
Still on your own computer, run (replace the placeholders):

```bash
gcloud compute ssh --zone YOUR_ZONE colab-vm -- -L 8888:localhost:8888
```

Leave this running — it securely forwards your computer's port 8888 to the VM's port 8888.

### Step 8 — Connect Colab to your VM
1. Open your notebook at [colab.research.google.com](https://colab.research.google.com).
2. Click the **Connect ▾** arrow (top right) → **Connect to a local runtime**.
3. Paste the token URL from Step 5 → **Connect**.

You're now connected to your own VM instead of Google's temporary one.

### Step 9 — Run it, then walk away
Click **Runtime → Run all**. Once cells are executing, you can:
- Close the terminal tunnel from Step 7.
- Close your laptop, or turn it off entirely.

Your code keeps running on the VM in Google's data center, because the Jupyter process is detached (via `tmux`) and doesn't depend on your SSH tunnel or your browser tab.

### Checking back in later
Reopen your computer, redo Step 7 (the tunnel), then reconnect in Colab the same way as Step 8. As long as you didn't stop the VM, the same Jupyter process is still there with your results.

---

## Part 3: Managing Cost

Unlike a subscription, a VM bills **by the second while it's running** — leaving it on all month will keep charging you.

- **When you're done:** Compute Engine → VM instances → select `colab-vm` → **Stop**. This halts billing for compute while keeping your setup for next time (a small storage fee still applies).
- **If you're finished for good:** **Delete** the instance instead, to stop all charges.
- Consider setting a **budget alert** under Billing → Budgets & alerts, so you get an email if costs creep up.

---

## Part 4: A Couple of Notes on Safety

- The `--NotebookApp.allow_origin` + token setup above is what keeps your notebook server from being hijacked by random websites — don't skip it, and don't expose port 8888 directly to the public internet.
- Tunneling through `gcloud compute ssh` (Step 7) is the safe way to reach your VM. Avoid opening a public firewall rule for Jupyter unless you know exactly what you're doing.
- Stop the VM when you're not using it — it's both cheaper and more secure.

---

## Part 5: A Simpler (but Less Reliable) Alternative

If your job is short and you already pay for **Colab Pro+**, there's a built-in "background execution" toggle that's supposed to keep a notebook running on Google's own servers after you close the browser — no VM setup required. In practice, many users report it disconnecting unexpectedly when a laptop sleeps or the tab is closed, so for anything you can't afford to lose, the personal VM method above is the dependable option.

---

## Quick Reference

| Task | Where |
|---|---|
| Create VM | Compute Engine → VM instances → Create Instance |
| Open terminal on VM | Compute Engine → VM instances → SSH button |
| Start notebook server | `jupyter notebook --NotebookApp.allow_origin=... --port=8888` (inside `tmux`) |
| Tunnel from your computer | `gcloud compute ssh --zone ZONE colab-vm -- -L 8888:localhost:8888` |
| Connect Colab | colab.research.google.com → Connect ▾ → Connect to a local runtime |
| Stop billing | Compute Engine → VM instances → Stop |
