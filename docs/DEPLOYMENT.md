# Automated deployment

The source implements the full pipeline in `template.yaml`. Direct Titan V2 and Nova 2 Lite calls succeeded from AWS CloudShell in `us-east-1` on 27 November 2026; the stack is not deployed and the PDF smoke test has not run. Tests and SAM packaging work without an AWS account; provisioning and the smoke test require an authorized AWS deployment identity.

## Local environment

Use Python 3.12:

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
pytest -q
sam validate --lint --region us-east-1
cfn-lint infra/github-oidc.yaml
sam build --region us-east-1
```

If `python3.12` is unavailable but `uv` is installed, create the environment with `uv venv --seed --python 3.12 .venv`, activate it, and install with `uv pip install -r requirements-dev.txt`. The `--seed` option provides pip for the SAM build.

Sign in with your usual AWS credential method. The scripts use the default credential chain or a named `--profile`; no credentials are committed. Your deployment principal needs CloudFormation/SAM provisioning privileges, IAM role creation/PassRole, storage/queue/API/Lambda management, and Bedrock model-definition/profile reads. For live verification it also needs API invocation permission. The AWS SAM-managed artifact bucket requires provisioning permission when `--artifact-bucket` is omitted.

The template selects Titan V2 and Nova 2 Lite's `us.amazon.nova-2-lite-v1:0` US inference profile. Default region is `us-east-1`; the template also allows `us-east-2` and `us-west-2` as source regions. The earlier DeepSeek R1 invocation was blocked as Legacy in this account. Preflight reads model/profile definitions; direct CloudShell probes do not prove Lambda execution-role access, Textract operation, or service quotas for the deployed flow. The live smoke test checks those boundaries. Account restrictions or regional SCPs can still deny cross-region Bedrock invocation. [AWS Nova 2 Lite model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html), [inference prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-prereq.html).

## Deploy from your default profile

```sh
python -m scripts.deploy --smoke-test
```

Or use a named profile:

```sh
python -m scripts.deploy --profile my-aws-profile --region us-east-1 --smoke-test
```

The script runs preflight, validates/builds SAM, and provisions the whole application without manual console wiring. Existing stack names must carry this project's ManagedBy tag; an unrelated stack is rejected rather than overwritten. CloudFormation exports the API URL, bucket, tables, failure queue URLs, and the API invocation ARN. These are saved in ignored `deployment.json`. Configure `RAG_API_BASE_URL` to the `ApiBaseUrl` output, including `/dev`, for the notebook/client.

The `--smoke-test` option uploads the actual Transformer PDF, polls for `READY`, checks document-scoped retrieval, queues a question, and polls for an answer/source result. It performs real Textract and model calls and incurs AWS usage. It verifies orchestration/source metadata, not a benchmark of factual answer quality. Omit it to deploy without running those calls.

## GitHub deployment with OIDC

The one-time bootstrap must run using AWS credentials authorized to create IAM deployment roles and an OIDC provider:

```sh
python -m scripts.bootstrap_github --configure-github
```

It creates/reuses the GitHub OIDC provider, provisions a private artifact bucket and two roles, and sets these repository variables through `gh`:

- `AWS_DEPLOY_ROLE_ARN`: assumed by GitHub Actions using a short-lived OIDC token.
- `AWS_CLOUDFORMATION_ROLE_ARN`: manages application resources under the project prefix.
- `AWS_ARTIFACT_BUCKET`: private SAM build-artifact storage.
- `AWS_REGION`: default `us-east-1`.
- `AWS_STACK_NAME`: default `rag-pdf`.

The OIDC trust permits only this repository's `main` branch and the STS audience. The bootstrap retains its original provider-ownership setting on repeat runs. Application role policies scope data/model resources; infrastructure deployment necessarily manages regional API/event-source resources whose generated IDs are not known in advance. [GitHub's AWS OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

Then run the **Deploy** workflow on `main` in GitHub Actions, or:

```sh
gh workflow run deploy.yml --ref main -f run_smoke_test=true
```

For deployment on every push to main, explicitly opt in:

```sh
gh variable set AUTO_DEPLOY --body true
```

CI always runs tests and packaging on pushes/PRs. The Deploy workflow waits for those checks. Deploy-on-push is disabled until the opt-in variable is set; manual runs require the AWS variables above. No long-lived AWS access keys are stored in GitHub.

Use the default project/stage names with the generated role policies. A custom stage or project must be reflected in bootstrap scopes and the client's invoke permission. The smoke-test documents belong to the IAM principal running the test; a different IAM user/role uploads its own documents.

## Runtime client access

IAM signatures authenticate API calls. Give a non-admin client `execute-api:Invoke` on the stack's `ApiInvokeResource` output. The Python client signs with the default AWS profile or `AWS_PROFILE`; it never sends AWS secret keys in an API JSON payload. All document and answer status routes check owner scope.

## Investigating a failed run

1. Poll `GET /documents/{document_id}` or `GET /answers/{job_id}` for the recorded state/error.
2. Inspect the corresponding Lambda log group; logs are retained for 14 days.
3. Inspect `PipelineFailureQueueUrl` or `AnswerFailureQueueUrl` from the outputs and their alarms.
4. Check Textract/S3 access, Bedrock profile/model access, and invocation quotas. The answer worker may wait for SQS visibility before retrying.

A permanently failed document is not automatically repaired; re-upload it under a new document ID after fixing the cause. A hard timeout/delivery failure can leave status in progress until retry/expiry. These recovery gaps are tracked in ROADMAP.md. Queue alarms are created, but no email/SNS alarm-notification destination or account budget is configured.

## Teardown and data preservation

Deleting the application CloudFormation stack removes its compute/API/queues and answer-job table. **The PDF bucket and document/chunk tables are retained**, including uploaded data. The OIDC bootstrap stack is separate, and its artifact bucket is also retained.

Retained resources keep their names. To recreate a deleted stack, import the retained resources or use a new project prefix; a new stack cannot create another bucket/table with the same existing name. Do not delete retained data merely to resolve that name conflict. Automated owner-scoped deletion and complete teardown tools are future work.
