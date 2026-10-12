import io
import json

import boto3
import pytest
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber
from shared import rag
from shared.common import ApiError


def test_titan_request_matches_bedrock_sdk_contract(aws, monkeypatch):
    bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
    monkeypatch.setattr(rag, "client", lambda *args, **kwargs: bedrock)
    vector = [1.0] + [0.0] * 255
    encoded = json.dumps({"embedding": vector}).encode()
    with Stubber(bedrock) as stub:
        stub.add_response(
            "invoke_model",
            {"body": StreamingBody(io.BytesIO(encoded), len(encoded)), "contentType": "application/json"},
            {
                "modelId": "amazon.titan-embed-text-v2:0",
                "contentType": "application/json",
                "accept": "application/json",
                "body": json.dumps({"inputText": "attention", "dimensions": 256, "normalize": True}),
            },
        )
        assert rag.embedding("attention", for_query=True) == vector
        stub.assert_no_pending_responses()


@pytest.mark.parametrize("stop_reason", ["end_turn", "max_tokens"])
def test_converse_contract_and_truncated_answer_handling(aws, monkeypatch, stop_reason):
    bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
    monkeypatch.setattr(rag, "client", lambda *args, **kwargs: bedrock)
    chunks = [
        {
            "document_id": "a" * 32,
            "chunk_id": "000000",
            "chunk_index": 0,
            "filename": "paper.pdf",
            "pages": [1],
            "text": "Attention is part of the Transformer.",
            "similarity_score": 0.9,
        }
    ]
    with Stubber(bedrock) as stub:
        stub.add_response(
            "converse",
            {
                "output": {
                    "message": {"role": "assistant", "content": [{"text": "Attention is used [S1]."}]}
                },
                "stopReason": stop_reason,
                "usage": {"inputTokens": 100, "outputTokens": 10, "totalTokens": 110},
                "metrics": {"latencyMs": 10},
            },
            {"modelId": "us.deepseek.r1-v1:0", "messages": ANY, "inferenceConfig": {"maxTokens": 4096}},
        )
        if stop_reason == "max_tokens":
            with pytest.raises(ApiError, match="output limit") as error:
                rag.generate("What is attention?", chunks)
            assert error.value.status == 422
        else:
            result = rag.generate("What is attention?", chunks)
            assert result["answer"] == "Attention is used [S1]."
            assert result["sources"][0]["pages"] == [1]
        stub.assert_no_pending_responses()
