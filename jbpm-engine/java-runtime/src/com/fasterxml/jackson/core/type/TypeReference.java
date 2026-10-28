package com.fasterxml.jackson.core.type;

/**
 * Source-compatible shim for {@code com.fasterxml.jackson.core.type.TypeReference} — the anonymous
 * generic-type token pattern real Jackson uses for deserializing into a generic type (e.g.
 * {@code new TypeReference<List<String>>(){}}). Generic type erasure means the real type parameter
 * isn't recoverable at runtime here (same as it wouldn't meaningfully help the plain-JDK-types
 * representation {@link com.fasterxml.jackson.databind.JsonIO} uses) — this shim exists purely so
 * that anonymous-class syntax compiles; {@code ObjectMapper.readValue}/{@code convertValue} ignore it.
 */
public abstract class TypeReference<T> {
    protected TypeReference() { }
}
