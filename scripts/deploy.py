"""Deploy every resource with SAM, export stack outputs, and optionally smoke test."""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError

ROOT = Path(__file__).resolve().parents[1]
REGIONS = ("us-east-1", "us-east-2", "us-west-2")
MANAGED_BY = "ucs531-cloud-rag"


def preflight(session):
    if session.get_credentials() is None:
        raise RuntimeError(
            "No AWS credentials are configured. Sign in with AWS SSO or configure the default AWS profile, then rerun deployment."
        )
    identity = session.client("sts").get_caller_identity()
    bedrock = session.client("bedrock")
    bedrock.get_foundation_model(modelIdentifier="amazon.titan-embed-text-v2:0")
    profile = bedrock.get_inference_profile(inferenceProfileIdentifier="us.deepseek.r1-v1:0")
    if profile.get("status") != "ACTIVE":
        raise RuntimeError("The DeepSeek inference profile is not active in the selected region.")
    print(f"Deploying to AWS account {identity['Account']} in {session.region_name}", flush=True)


def ensure_stack_scope(cloudformation, name):
    try:
        stack = cloudformation.describe_stacks(StackName=name)["Stacks"][0]
    except ClientError as error:
        if error.response["Error"]["Code"] == "ValidationError" and "does not exist" in str(error):
            return
        raise
    tags = {tag["Key"]: tag["Value"] for tag in stack.get("Tags", [])}
    if tags.get("ManagedBy") != MANAGED_BY:
        raise RuntimeError(
            f"Stack {name} already exists and is not managed by this project. Choose a different project/stack name."
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", help="Uses the default AWS credential chain when omitted")
    parser.add_argument("--region", default="us-east-1", choices=REGIONS)
    parser.add_argument("--stack-name", default="rag-pdf")
    parser.add_argument("--stage", default="dev")
    parser.add_argument("--cloudformation-role-arn")
    parser.add_argument("--artifact-bucket", default=os.environ.get("AWS_ARTIFACT_BUCKET"))
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="Run a real sample PDF through the deployed stack (incurs AWS usage)",
    )
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]{2,23}", args.stack_name):
        parser.error(
            "stack-name must contain 3–24 lowercase letters, digits, or hyphens and start with a letter"
        )
    if not re.fullmatch(r"[a-zA-Z0-9]+", args.stage):
        parser.error("stage must be alphanumeric")
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    try:
        preflight(session)
        ensure_stack_scope(session.client("cloudformation"), args.stack_name)
    except (BotoCoreError, ClientError, RuntimeError) as error:
        raise SystemExit(f"AWS preflight failed: {error}") from error
    sam = shutil.which("sam") or str(Path(sys.executable).with_name("sam"))
    if not Path(sam).is_file():
        raise SystemExit(
            "SAM CLI is missing. Install requirements-dev.txt into the project's virtual environment."
        )
    environment = dict(
        os.environ, SAM_CLI_TELEMETRY="0", AWS_DEFAULT_REGION=args.region, AWS_REGION=args.region
    )
    if args.profile:
        environment["AWS_PROFILE"] = args.profile
    for command in ([sam, "validate", "--lint"], [sam, "build", "--cached"]):
        subprocess.run(command, cwd=ROOT, env=environment, check=True)
    command = [
        sam,
        "deploy",
        "--stack-name",
        args.stack_name,
        "--region",
        args.region,
        "--capabilities",
        "CAPABILITY_IAM",
        "--no-confirm-changeset",
        "--no-fail-on-empty-changeset",
        "--parameter-overrides",
        f"ProjectName={args.stack_name}",
        f"StageName={args.stage}",
        "--tags",
        f"ManagedBy={MANAGED_BY}",
    ]
    if args.artifact_bucket:
        command.extend(["--s3-bucket", args.artifact_bucket])
    else:
        command.append("--resolve-s3")
    if args.cloudformation_role_arn:
        command.extend(["--role-arn", args.cloudformation_role_arn])
    subprocess.run(command, cwd=ROOT, env=environment, check=True)
    stack = session.client("cloudformation").describe_stacks(StackName=args.stack_name)["Stacks"][0]
    outputs = {item["OutputKey"]: item["OutputValue"] for item in stack["Outputs"]}
    (ROOT / "deployment.json").write_text(json.dumps(outputs, indent=2) + "\n")
    print(f"API ready: {outputs['ApiBaseUrl']}", flush=True)
    print("Stack outputs saved to ignored deployment.json", flush=True)
    if args.smoke_test:
        from scripts.smoke_test import run

        run(outputs["ApiBaseUrl"], profile=args.profile)


if __name__ == "__main__":
    main()
