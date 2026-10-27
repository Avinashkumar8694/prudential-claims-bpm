package org.json;

import com.fasterxml.jackson.databind.JsonIO;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * Lightweight org.json.JSONArray shim for jBPM script tasks.
 */
public class JSONArray {
    private final List<Object> list = new ArrayList<Object>();

    public JSONArray() {}

    @SuppressWarnings("unchecked")
    public JSONArray(String json) {
        if (json != null && !json.trim().isEmpty()) {
            Object parsed = JsonIO.parse(json.trim());
            if (parsed instanceof List) {
                list.addAll((List<Object>) parsed);
            }
        }
    }

    public JSONArray(Collection<?> c) {
        if (c != null) {
            list.addAll(c);
        }
    }

    public JSONArray put(Object value) {
        list.add(value);
        return this;
    }

    public Object get(int index) {
        return list.get(index);
    }

    public Object opt(int index) {
        return (index >= 0 && index < list.size()) ? list.get(index) : null;
    }

    public int length() {
        return list.size();
    }

    public List<Object> toList() {
        return new ArrayList<Object>(list);
    }

    @Override
    public String toString() {
        return JsonIO.write(list);
    }

    public String toString(int indent) {
        return JsonIO.write(list);
    }
}
