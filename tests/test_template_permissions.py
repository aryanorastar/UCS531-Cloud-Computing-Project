"""Guard the event source permissions that local handler tests cannot exercise."""

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
