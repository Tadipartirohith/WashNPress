#!/usr/bin/env python3
"""Run the smoke test against a remote host over SSH using paramiko.

This copies scripts/smoke_test.py to the remote host and runs it there, so you can
verify a deployment running on another machine. It reads connection details from
environment variables so no secret is written into the file.

Environment variables:
    SSH_HOST      the remote host name or address
    SSH_USER      the SSH user name
    SSH_KEY       path to a private key file, optional if using an agent
    SSH_PASSWORD  password, optional if using a key
    REMOTE_BASE_URL  the base URL to test on the remote host, default http://localhost:8080

Install paramiko first:
    pip install paramiko
"""
import os
import sys

try:
    import paramiko
except ImportError:
    print("paramiko is not installed. Run: pip install paramiko")
    sys.exit(1)

HOST = os.environ.get("SSH_HOST")
USER = os.environ.get("SSH_USER")
KEY = os.environ.get("SSH_KEY")
PASSWORD = os.environ.get("SSH_PASSWORD")
REMOTE_BASE = os.environ.get("REMOTE_BASE_URL", "http://localhost:8080")

if not HOST or not USER:
    print("Set SSH_HOST and SSH_USER at least.")
    sys.exit(1)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
connect_args = {"hostname": HOST, "username": USER}
if KEY:
    connect_args["key_filename"] = KEY
if PASSWORD:
    connect_args["password"] = PASSWORD
client.connect(**connect_args)

local_script = os.path.join(os.path.dirname(__file__), "smoke_test.py")
sftp = client.open_sftp()
sftp.put(local_script, "/tmp/smoke_test.py")
sftp.close()

command = "BASE_URL=%s python3 /tmp/smoke_test.py" % REMOTE_BASE
stdin, stdout, stderr = client.exec_command(command)
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print(err)
exit_code = stdout.channel.recv_exit_status()
client.close()
sys.exit(exit_code)
