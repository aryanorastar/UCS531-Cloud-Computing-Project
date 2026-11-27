from unittest.mock import Mock, patch

import pytest
import requests
from botocore.credentials import Credentials

from client import AwsAuth, RagClient
from scripts.bootstrap_github import provider_parameter
from scripts.deploy import MANAGED_BY, ensure_stack_scope, preflight


def test_sigv4_signing():
    session = Mock()
    session.get_credentials.return_value = Credentials("test-key", "test-secret", "test-session")
    prepared = requests.Request(
        "POST",
        "https://example.execute-api.us-east-1.amazonaws.com/dev/query",
        json={"question": "attention"},
    ).prepare()
    signed = AwsAuth(session, "us-east-1")(prepared)
    assert signed.headers["Authorization"].startswith("AWS4-HMAC-SHA256 ")
    assert "/us-east-1/execute-api/aws4_request" in signed.headers["Authorization"]
    assert signed.headers["X-Amz-Security-Token"] == "test-session"


def test_unconfigured_url_and_credentials_stop():
    with pytest.raises(ValueError, match="RAG_API_BASE_URL"):
        RagClient("")
    session = Mock()
    session.get_credentials.return_value = None
    with pytest.raises(RuntimeError, match="AWS profile"):
        AwsAuth(session, "us-east-1")(requests.Request("GET", "https://example.invalid").prepare())
    with pytest.raises(RuntimeError, match="No AWS credentials"):
        preflight(session)
    session.client.assert_not_called()


def test_client_polls_ready_and_answer(aws):
    client = RagClient("https://example.execute-api.us-east-1.amazonaws.com/dev")
    client.request = Mock(side_effect=[{"status": "EMBEDDING"}, {"status": "READY"}])
    with patch("client.time.sleep"):
        assert client.wait_document("a" * 32)["status"] == "READY"
    client.request = Mock(
        side_effect=[
            {"job_id": "b" * 32},
            {"status": "GENERATING"},
            {"status": "COMPLETED", "result": {"answer": "result", "sources": []}},
        ]
    )
    with patch("client.time.sleep"):
        assert client.answer("attention", "a" * 32)["answer"] == "result"


def test_client_failed_document_and_job(aws):
    client = RagClient("https://example.execute-api.us-east-1.amazonaws.com/dev")
    client.request = Mock(return_value={"status": "FAILED", "error_message": "Extraction failed"})
    with pytest.raises(RuntimeError, match="Extraction failed"):
        client.wait_document("a" * 32)
    client.request = Mock(
        side_effect=[{"job_id": "b" * 32}, {"status": "FAILED", "error_message": "Model unavailable"}]
    )
    with pytest.raises(RuntimeError, match="Model unavailable"):
        client.answer("attention", "a" * 32)


def test_bootstrap_keeps_its_owned_oidc_provider_on_updates():
    arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    owned = {"Parameters": [{"ParameterKey": "ExistingOidcProviderArn", "ParameterValue": ""}]}
    reused = {"Parameters": [{"ParameterKey": "ExistingOidcProviderArn", "ParameterValue": arn}]}
    assert provider_parameter(owned, arn) == ""
    assert provider_parameter(reused, "") == arn
    assert provider_parameter(None, arn) == arn


def test_deployment_does_not_replace_an_unrelated_stack():
    cf = Mock()
    cf.describe_stacks.return_value = {
        "Stacks": [{"Tags": [{"Key": "ManagedBy", "Value": "another-project"}]}]
    }
    with pytest.raises(RuntimeError, match="not managed by this project"):
        ensure_stack_scope(cf, "rag-pdf")
    cf.describe_stacks.return_value = {"Stacks": [{"Tags": [{"Key": "ManagedBy", "Value": MANAGED_BY}]}]}
    ensure_stack_scope(cf, "rag-pdf")


def test_preflight_checks_the_active_nova_profile():
    session = Mock(region_name="us-east-1")
    session.get_credentials.return_value = Mock()
    session.client("sts").get_caller_identity.return_value = {"Account": "123456789012"}
    bedrock = session.client("bedrock")
    bedrock.get_inference_profile.return_value = {"status": "ACTIVE"}

    preflight(session)

    bedrock.get_foundation_model.assert_called_once_with(modelIdentifier="amazon.titan-embed-text-v2:0")
    bedrock.get_inference_profile.assert_called_once_with(
        inferenceProfileIdentifier="us.amazon.nova-2-lite-v1:0"
    )
    bedrock.get_inference_profile.return_value = {"status": "INACTIVE"}
    with pytest.raises(RuntimeError, match="Nova 2 Lite inference profile is not active"):
        preflight(session)
