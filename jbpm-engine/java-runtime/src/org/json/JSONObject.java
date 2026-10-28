package org.json;

import com.fasterxml.jackson.databind.JsonIO;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Lightweight org.json.JSONObject shim for jBPM script tasks.
 */
public class JSONObject {
    private final Map<String, Object> map = new LinkedHashMap<String, Object>();

    public JSONObject() {}

    @SuppressWarnings("unchecked")
    public JSONObject(String json) {
        if (json != null && !json.trim().isEmpty()) {
            Object parsed = JsonIO.parse(json.trim());
            if (parsed instanceof Map) {
                map.putAll((Map<String, Object>) parsed);
            }
        }
    }

    public JSONObject(Map<String, ?> m) {
        if (m != null) {
            for (Map.Entry<String, ?> e : m.entrySet()) {
                map.put(e.getKey(), e.getValue());
            }
        }
    }

    public JSONObject put(String key, Object value) {
        if (key != null) {
            map.put(key, value);
        }
        return this;
    }

    public JSONObject put(String key, boolean value) {
        return put(key, Boolean.valueOf(value));
    }

    public JSONObject put(String key, int value) {
        return put(key, Integer.valueOf(value));
    }

    public JSONObject put(String key, long value) {
        return put(key, Long.valueOf(value));
    }

    public JSONObject put(String key, double value) {
        return put(key, Double.valueOf(value));
    }

    public Object get(String key) {
        return map.get(key);
    }

    public String getString(String key) {
        Object val = map.get(key);
        return val == null ? null : String.valueOf(val);
    }

    public String optString(String key) {
        return optString(key, "");
    }

    public String optString(String key, String fallback) {
        Object val = map.get(key);
        return val == null ? fallback : String.valueOf(val);
    }

    public boolean optBoolean(String key) {
        return optBoolean(key, false);
    }

    public boolean optBoolean(String key, boolean fallback) {
        Object val = map.get(key);
        if (val == null) return fallback;
        if (val instanceof Boolean) return ((Boolean) val).booleanValue();
        String s = String.valueOf(val).trim().toLowerCase();
        if ("true".equals(s) || "1".equals(s)) return true;
        if ("false".equals(s) || "0".equals(s)) return false;
        return fallback;
    }

    public int optInt(String key) {
        return optInt(key, 0);
    }

    public int optInt(String key, int fallback) {
        Object val = map.get(key);
        if (val == null) return fallback;
        if (val instanceof Number) return ((Number) val).intValue();
        try { return Integer.parseInt(String.valueOf(val).trim()); } catch (Exception e) { return fallback; }
    }

    public long optLong(String key) {
        return optLong(key, 0L);
    }

    public long optLong(String key, long fallback) {
        Object val = map.get(key);
        if (val == null) return fallback;
        if (val instanceof Number) return ((Number) val).longValue();
        try { return Long.parseLong(String.valueOf(val).trim()); } catch (Exception e) { return fallback; }
    }

    public double optDouble(String key, double fallback) {
        Object val = map.get(key);
        if (val == null) return fallback;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try { return Double.parseDouble(String.valueOf(val).trim()); } catch (Exception e) { return fallback; }
    }

    public boolean has(String key) {
        return map.containsKey(key);
    }

    public boolean isNull(String key) {
        return map.get(key) == null;
    }

    public Set<String> keySet() {
        return map.keySet();
    }

    public Map<String, Object> toMap() {
        return new LinkedHashMap<String, Object>(map);
    }

    @Override
    public String toString() {
        return JsonIO.write(map);
    }

    public String toString(int indent) {
        return JsonIO.write(map);
    }
}
