package com.fasterxml.jackson.databind;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Internal JSON parse/serialize helper. Not part of the real Jackson API — this whole package is a
 * from-scratch, source-compatible shim so real jBPM scripts' Jackson imports resolve without needing
 * the actual upstream jar (no Maven available in this environment). Raw values use plain JDK types
 * uniformly: null, String, Long/Double, Boolean, LinkedHashMap&lt;String,Object&gt; (object),
 * ArrayList&lt;Object&gt; (array) — matched by JsonNode's accessor methods. Public (not
 * package-private) because it's also reused directly by the bpmscript sidecar's own request/response
 * wire protocol, so the whole sidecar needs exactly one JSON implementation, not two.
 */
public final class JsonIO {
    private JsonIO() { }

    public static Object parse(String text) {
        if (text == null) return null;
        Parser p = new Parser(text);
        p.skipWs();
        if (p.pos >= p.len) return null;
        Object v = p.parseValue();
        return v;
    }

    public static String write(Object v) {
        StringBuilder sb = new StringBuilder();
        writeValue(v, sb);
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static void writeValue(Object v, StringBuilder sb) {
        if (v == null) { sb.append("null"); return; }
        if (v instanceof String) { writeString((String) v, sb); return; }
        if (v instanceof Boolean || v instanceof Number) { sb.append(v.toString()); return; }
        if (v instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> e : ((Map<String, Object>) v).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                writeString(e.getKey(), sb);
                sb.append(':');
                writeValue(e.getValue(), sb);
            }
            sb.append('}');
            return;
        }
        if (v instanceof List) {
            sb.append('[');
            boolean first = true;
            for (Object item : (List<Object>) v) {
                if (!first) sb.append(',');
                first = false;
                writeValue(item, sb);
            }
            sb.append(']');
            return;
        }
        // fall back to a JSON string of its toString() for anything unrecognized
        writeString(v.toString(), sb);
    }

    private static void writeString(String s, StringBuilder sb) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
    }

    private static final class Parser {
        final String s;
        final int len;
        int pos;

        Parser(String s) { this.s = s; this.len = s.length(); this.pos = 0; }

        void skipWs() { while (pos < len && Character.isWhitespace(s.charAt(pos))) pos++; }

        Object parseValue() {
            skipWs();
            char c = s.charAt(pos);
            if (c == '{') return parseObject();
            if (c == '[') return parseArray();
            if (c == '"') return parseString();
            if (c == 't') { expect("true"); return Boolean.TRUE; }
            if (c == 'f') { expect("false"); return Boolean.FALSE; }
            if (c == 'n') { expect("null"); return null; }
            return parseNumber();
        }

        Map<String, Object> parseObject() {
            Map<String, Object> m = new LinkedHashMap<String, Object>();
            pos++; // {
            skipWs();
            if (pos < len && s.charAt(pos) == '}') { pos++; return m; }
            while (true) {
                skipWs();
                String key = parseString();
                skipWs();
                pos++; // :
                Object val = parseValue();
                m.put(key, val);
                skipWs();
                char c = s.charAt(pos);
                if (c == ',') { pos++; continue; }
                if (c == '}') { pos++; break; }
                throw new RuntimeException("malformed JSON object at " + pos);
            }
            return m;
        }

        List<Object> parseArray() {
            List<Object> a = new ArrayList<Object>();
            pos++; // [
            skipWs();
            if (pos < len && s.charAt(pos) == ']') { pos++; return a; }
            while (true) {
                Object val = parseValue();
                a.add(val);
                skipWs();
                char c = s.charAt(pos);
                if (c == ',') { pos++; continue; }
                if (c == ']') { pos++; break; }
                throw new RuntimeException("malformed JSON array at " + pos);
            }
            return a;
        }

        String parseString() {
            skipWs();
            pos++; // opening quote
            StringBuilder sb = new StringBuilder();
            while (true) {
                char c = s.charAt(pos++);
                if (c == '"') break;
                if (c == '\\') {
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'u':
                            String hex = s.substring(pos, pos + 4);
                            sb.append((char) Integer.parseInt(hex, 16));
                            pos += 4;
                            break;
                        default: sb.append(e);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        Object parseNumber() {
            int start = pos;
            boolean isFloat = false;
            if (s.charAt(pos) == '-') pos++;
            while (pos < len && Character.isDigit(s.charAt(pos))) pos++;
            if (pos < len && s.charAt(pos) == '.') { isFloat = true; pos++; while (pos < len && Character.isDigit(s.charAt(pos))) pos++; }
            if (pos < len && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                isFloat = true; pos++;
                if (pos < len && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) pos++;
                while (pos < len && Character.isDigit(s.charAt(pos))) pos++;
            }
            String num = s.substring(start, pos);
            if (isFloat) return Double.valueOf(num);
            // matches real Jackson's default untyped-number deserialization: Integer when it fits,
            // widening to Long/BigInteger only when it doesn't — jBPM scripts routinely do
            // `(int) kcontext.getVariable(...)`/`(Integer) ...` on small counters and expect exactly
            // this (a Long can't be cast to Integer even though both are boxed numeric types).
            try { return Integer.valueOf(num); } catch (NumberFormatException e) { /* fall through */ }
            try { return Long.valueOf(num); } catch (NumberFormatException e) { /* fall through */ }
            try { return new java.math.BigInteger(num); } catch (NumberFormatException e) { return Double.valueOf(num); }
        }

        void expect(String lit) {
            if (!s.regionMatches(pos, lit, 0, lit.length())) throw new RuntimeException("malformed JSON at " + pos);
            pos += lit.length();
        }
    }
}
