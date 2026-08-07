package com.fasterxml.jackson.databind.node;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/**
 * Source-compatible shim for {@code com.fasterxml.jackson.databind.node.ArrayNode} — a mutable
 * {@link JsonNode} backed by an {@code ArrayList<Object>}.
 */
public class ArrayNode extends JsonNode {
    @SuppressWarnings("unchecked")
    public ArrayNode() { super(new ArrayList<Object>()); }

    /** wraps an already-parsed list by reference — see ObjectNode's matching constructor for why. */
    public ArrayNode(List<Object> raw) { super(raw); }

    @SuppressWarnings("unchecked")
    private List<Object> list() { return (List<Object>) raw; }

    public ArrayNode add(String value) { list().add(value); return this; }
    public ArrayNode add(int value) { list().add(Long.valueOf(value)); return this; }
    public ArrayNode add(long value) { list().add(Long.valueOf(value)); return this; }
    public ArrayNode add(double value) { list().add(Double.valueOf(value)); return this; }
    public ArrayNode add(boolean value) { list().add(Boolean.valueOf(value)); return this; }
    public ArrayNode add(JsonNode value) { list().add(value == null ? null : value.rawValue()); return this; }

    public ArrayNode addPOJO(Object value) {
        list().add(value instanceof JsonNode ? ((JsonNode) value).rawValue() : value);
        return this;
    }
}
