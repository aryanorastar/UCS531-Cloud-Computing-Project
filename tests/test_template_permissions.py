"""Guard AWS permissions that local handler tests cannot exercise."""

from pathlib import Path

import yaml


class SamLoader(yaml.SafeLoader):
    pass


def load_intrinsic(loader, _tag, node):
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_mapping(node)


SamLoader.add_multi_constructor("!", load_intrinsic)


def statements(resources, function):
    return [
        statement
        for policy in resources[function]["Properties"]["Policies"]
        for statement in policy["Statement"]
    ]


def test_event_source_roles_can_read_their_scoped_sources():
    template = yaml.load(Path("template.yaml").read_text(), Loader=SamLoader)
    resources = template["Resources"]

    stream = resources["GenerateEmbeddings"]["Properties"]["Events"]["PendingChunks"]["Properties"]["Stream"]
    stream_actions = {
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListStreams",
    }
    assert any(
        statement["Effect"] == "Allow"
        and statement["Resource"] == stream
        and stream_actions <= set(statement["Action"])
        for statement in statements(resources, "GenerateEmbeddings")
    )

    queue = resources["GenerateAnswer"]["Properties"]["Events"]["AnswerWork"]["Properties"]["Queue"]
    queue_actions = {"sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"}
    assert any(
        statement["Effect"] == "Allow"
        and statement["Resource"] == queue
        and queue_actions <= set(statement["Action"])
        for statement in statements(resources, "GenerateAnswer")
    )


def test_generation_role_can_invoke_nova_profile_and_all_destinations():
    template = yaml.load(Path("template.yaml").read_text(), Loader=SamLoader)
    assert template["Parameters"]["GenerationModelId"]["Default"] == "us.amazon.nova-2-lite-v1:0"
    resources = template["Resources"]
    expected_resources = {
        "arn:${AWS::Partition}:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/${GenerationModelId}",
        *(
            f"arn:${{AWS::Partition}}:bedrock:{region}::foundation-model/amazon.nova-2-lite-v1:0"
            for region in ("us-east-1", "us-east-2", "us-west-2")
        ),
    }
    assert any(
        statement["Effect"] == "Allow"
        and "bedrock:InvokeModel" in statement["Action"]
        and expected_resources <= set(statement["Resource"])
        for statement in statements(resources, "GenerateAnswer")
    )
