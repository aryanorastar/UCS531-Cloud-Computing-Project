"""One-time AWS OIDC bootstrap; optionally configure this repository's deployment variables."""

import argparse
import re
import subprocess
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from scripts.deploy import MANAGED_BY, REGIONS, ensure_stack_scope, preflight


def provider_parameter(stack, discovered):
    # Keep a provider created by this stack owned by this stack on updates.
    # Switching to its discovered ARN would disable the condition and delete it.
    if stack:
        return next(
            (
                p["ParameterValue"]
                for p in stack.get("Parameters", [])
                if p["ParameterKey"] == "ExistingOidcProviderArn"
            ),
            discovered,
        )
    return discovered


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile")
    parser.add_argument("--region", choices=REGIONS, default="us-east-1")
    parser.add_argument("--project", default="rag-pdf")
    parser.add_argument("--repository", default="aryanorastar/UCS531-Cloud-Computing-Project")
    parser.add_argument("--configure-github", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]{2,23}", args.project):
        parser.error("project must contain 3–24 lowercase letters, digits, or hyphens")
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    preflight(session)
    iam = session.client("iam")
    existing = next(
        (
            item["Arn"]
            for item in iam.list_open_id_connect_providers()["OpenIDConnectProviderList"]
            if item["Arn"].endswith("oidc-provider/token.actions.githubusercontent.com")
        ),
        "",
    )
    cf = session.client("cloudformation")
    name = args.project + "-github"
    ensure_stack_scope(cf, name)
    try:
        stack = cf.describe_stacks(StackName=name)["Stacks"][0]
    except ClientError as error:
        if error.response["Error"]["Code"] != "ValidationError" or "does not exist" not in str(error):
            raise
        stack = None
    existing = provider_parameter(stack, existing)
    template = (Path(__file__).resolve().parents[1] / "infra/github-oidc.yaml").read_text()
    parameters = [
        {"ParameterKey": "ProjectName", "ParameterValue": args.project},
        {"ParameterKey": "Repository", "ParameterValue": args.repository},
        {"ParameterKey": "ExistingOidcProviderArn", "ParameterValue": existing},
    ]
    request = {
        "StackName": name,
        "TemplateBody": template,
        "Parameters": parameters,
        "Capabilities": ["CAPABILITY_NAMED_IAM"],
        "Tags": [{"Key": "ManagedBy", "Value": MANAGED_BY}],
    }
    try:
        cf.create_stack(**request)
        waiter = "stack_create_complete"
    except ClientError as error:
        if error.response["Error"]["Code"] != "AlreadyExistsException":
            raise
        try:
            cf.update_stack(**request)
            waiter = "stack_update_complete"
        except ClientError as update_error:
            if "No updates are to be performed" not in str(update_error):
                raise
            waiter = None
    if waiter:
        print(f"Waiting for {name} to provision OIDC deployment resources", flush=True)
        cf.get_waiter(waiter).wait(StackName=name)
    outputs = {
        item["OutputKey"]: item["OutputValue"]
        for item in cf.describe_stacks(StackName=name)["Stacks"][0]["Outputs"]
    }
    variables = {
        "AWS_DEPLOY_ROLE_ARN": outputs["DeployRoleArn"],
        "AWS_CLOUDFORMATION_ROLE_ARN": outputs["CloudFormationRoleArn"],
        "AWS_ARTIFACT_BUCKET": outputs["ArtifactBucketName"],
        "AWS_REGION": args.region,
        "AWS_STACK_NAME": args.project,
    }
    if args.configure_github:
        for name, value in variables.items():
            subprocess.run(
                ["gh", "variable", "set", name, "--repo", args.repository, "--body", value], check=True
            )
        print("GitHub deployment variables configured. Run the Deploy workflow from main.")
    else:
        for name, value in variables.items():
            print(f"{name}={value}")


if __name__ == "__main__":
    main()
