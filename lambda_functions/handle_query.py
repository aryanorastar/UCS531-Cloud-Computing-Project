"""Retrieve relevant passages from documents owned by the signed caller."""

from shared.common import api_handler, body, owner_id, question_parameters, response
from shared.rag import retrieve


@api_handler
def lambda_handler(event, context):
    owner = owner_id(event)
    question, document_id, top_k = question_parameters(body(event))
    return response(200, {"top_chunks": retrieve(question, owner, document_id, top_k, for_query=True)})
