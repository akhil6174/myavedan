# Notice reader on a free Indian server (Oracle Cloud)

The notice reader must run from India: many government recruitment sites don't answer computers abroad. For launch it runs on an **Oracle Cloud Always Free** server in **Mumbai or Hyderabad**, 24/7, at no cost. Your PC is only a backup.

Total time: about 45 minutes, most of it Oracle's sign-up checks.

## 1. Create the Oracle Cloud account (about 20 minutes)

1. Go to **https://signup.cloud.oracle.com/**.
2. Country: **India**. Use your MyAvedan email.
3. **Home region:** choose **India West (Mumbai)** or **India South (Hyderabad)**. This cannot be changed later, and Always Free servers only run in the home region.
4. Verify your card. Oracle places a small temporary hold to check it and releases it. Always Free resources aren't charged.
5. Wait for the "your account is ready" email (minutes, occasionally hours).

## 2. Create the server (about 10 minutes)

1. Sign in at **https://cloud.oracle.com/** → menu ☰ → **Compute → Instances → Create instance**.
2. **Name:** `myavedan-reader`.
3. **Image:** click **Edit** → **Change image** → **Canonical Ubuntu 24.04**.
4. **Shape:** click **Change shape**:
   - First choice: **Ampere → VM.Standard.A1.Flex**, **1 OCPU, 6 GB memory** (look for the "Always Free-eligible" label).
   - If it says *out of capacity*: try again later, or choose **Specialty and previous generation → VM.Standard.E2.1.Micro** (also Always Free; 1 GB, enough for the reader).
5. **Networking:** keep the defaults (new network, public IP address).
6. **Add SSH keys:** choose **Generate a key pair for me** → **Save private key**. Keep the downloaded `.key` file safe (for example in `C:\Users\A.D\.ssh\`). Anyone with it can log in to the server.
7. **Create**. When the instance is **Running**, copy its **Public IP address**.

No ports need opening: the reader only makes outgoing connections.

## 3. Connect from your PC (2 minutes)

In PowerShell (Windows has SSH built in):

```
icacls "C:\Users\A.D\.ssh\myavedan-reader.key" /inheritance:r /grant:r "$($env:USERNAME):R"
ssh -i "C:\Users\A.D\.ssh\myavedan-reader.key" ubuntu@PUBLIC_IP
```

Replace the file name and `PUBLIC_IP`. Answer **yes** the first time. You're in when the prompt shows `ubuntu@myavedan-reader`.

## 4. Install the reader (about 10 minutes, automatic)

1. On GitHub: **akhil6174/myavedan → Settings → Actions → Runners → New self-hosted runner → Linux**. Copy only the token after `--token` in the "Configure" command. It's valid for about an hour.
2. On the server, run these two commands. Paste your token in place of `TOKEN`:

```
curl -fsSL -o setup-runner.sh https://raw.githubusercontent.com/akhil6174/myavedan/main/deploy/oracle/setup-runner.sh
RUNNER_TOKEN=TOKEN bash setup-runner.sh
```

3. When it prints **Done**, GitHub → **Settings → Actions → Runners** shows **oracle-india** as **Idle**.

## 5. Test it

GitHub → **Actions → Notice reader → Run workflow** → mode **discover**, dry run **ticked** → **Run**. The run should go green on `oracle-india`, listing each site it checked.

Then switch your PC runner off (close `run.cmd`, or stop the "GitHub Actions Runner" Windows service) so only the server reads notices. Each machine keeps its own memory of what it has seen, so running both would duplicate effort.

## Keeping it free and alive

- **Always Free** covers this server indefinitely. Check **Billing → Cost analysis** shows ₹0 after the first month.
- Oracle may reclaim an Always Free server that sits almost completely idle for 7 days. The reader runs twice a day, which may not count as busy. To remove the risk, upgrade the account to **Pay As You Go** (Billing → Upgrade). Always Free resources stay free, and a budget alert can be set at ₹1.
- Security updates install automatically. The server accepts SSH logins only with your key file.
- If the server is ever lost: create a new one and repeat steps 2–4. Nothing important lives only on the server; the reader's memory just starts again (first visits go to backlog).
