package com.fasterxml.jackson.databind;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Source-compatible shim for {@code com.fasterxml.jackson.databind.ObjectMapper} — the handful of
 * methods real jBPM script/onEntry/onExit code actually calls to build and parse JSON payloads.
 */
public class ObjectMapper {
    public ObjectNode createObjectNode() { return new ObjectNode(); }
    public ArrayNode createArrayNode() { return new ArrayNode(); }

    public JsonNode readTree(String text) {
        if (text == null || text.isEmpty()) return null;
        return JsonNode.wrap(JsonIO.parse(text));
    }

    @SuppressWarnings("unchecked")
    public <T> T convertValue(Object value, Class<T> targetType) {
        return (T) (value instanceof JsonNode ? ((JsonNode) value).rawValue() : value);
    }

    @SuppressWarnings("unchecked")
    public <T> T convertValue(Object value, TypeReference<T> typeRef) {
        return (T) (value instanceof JsonNode ? ((JsonNode) value).rawValue() : value);
    }

    @SuppressWarnings("unchecked")
    public <T> T readValue(String text, Class<T> targetType) {
        if (text == null || text.isEmpty()) return null;
        return (T) JsonIO.parse(text);
    }

    @SuppressWarnings("unchecked")
    public <T> T readValue(String text, TypeReference<T> typeRef) {
        if (text == null || text.isEmpty()) return null;
        return (T) JsonIO.parse(text);
    }

    public String writeValueAsString(Object value) {
        Object raw = value instanceof JsonNode ? ((JsonNode) value).rawValue() : value;
        return JsonIO.write(raw);
    }
}
