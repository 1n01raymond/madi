#include <IFSelect_ReturnStatus.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <TCollection_AsciiString.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDF_Tool.hxx>
#include <TDocStd_Document.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Trsf.hxx>

#include <array>
#include <cstddef>
#include <cstdlib>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

struct PrototypeRecord {
  std::string source_label;
  std::size_t face_count = 0;
  std::vector<std::string> edge_source_refs;
};

struct OccurrenceRecord {
  std::string id;
  std::string parent_id;
  std::string prototype_id;
  std::string source_label;
  std::array<double, 16> transform{};
};

std::string escape_json(const std::string& value) {
  std::string result;
  result.reserve(value.size());
  for (const char character : value) {
    switch (character) {
      case '\\': result += "\\\\"; break;
      case '"': result += "\\\""; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      default: result += character; break;
    }
  }
  return result;
}

std::string label_entry(const TDF_Label& label) {
  TCollection_AsciiString entry;
  TDF_Tool::Entry(label, entry);
  return entry.ToCString();
}

std::array<double, 16> row_major_transform(const TopLoc_Location& location) {
  const gp_Trsf transform = location.Transformation();
  return {
    transform.Value(1, 1), transform.Value(1, 2), transform.Value(1, 3), transform.Value(1, 4),
    transform.Value(2, 1), transform.Value(2, 2), transform.Value(2, 3), transform.Value(2, 4),
    transform.Value(3, 1), transform.Value(3, 2), transform.Value(3, 3), transform.Value(3, 4),
    0.0, 0.0, 0.0, 1.0,
  };
}

std::size_t count_subshapes(const TopoDS_Shape& shape, const TopAbs_ShapeEnum kind) {
  std::size_t count = 0;
  for (TopExp_Explorer explorer(shape, kind); explorer.More(); explorer.Next()) {
    ++count;
  }
  return count;
}

class Extractor {
 public:
  explicit Extractor(Handle(XCAFDoc_ShapeTool) shape_tool)
      : shape_tool_(std::move(shape_tool)) {}

  void visit(const TDF_Label& occurrence_label, const std::string& parent_id) {
    TDF_Label prototype_label = occurrence_label;
    if (shape_tool_->IsReference(occurrence_label)) {
      if (!shape_tool_->GetReferredShape(occurrence_label, prototype_label)) {
        throw std::runtime_error("XDE reference does not resolve: " + label_entry(occurrence_label));
      }
    }

    const std::string prototype_id = label_entry(prototype_label);
    ensure_prototype(prototype_id, prototype_label);

    const std::string occurrence_id =
        "occurrence:" + std::to_string(occurrences_.size()) + ":" + label_entry(occurrence_label);
    occurrences_.push_back({
      occurrence_id,
      parent_id,
      prototype_id,
      label_entry(occurrence_label),
      row_major_transform(shape_tool_->GetLocation(occurrence_label)),
    });

    TDF_LabelSequence components;
    shape_tool_->GetComponents(prototype_label, components, false);
    for (Standard_Integer index = 1; index <= components.Length(); ++index) {
      visit(components.Value(index), occurrence_id);
    }
  }

  void write_json(std::ostream& output, const std::string& source) const {
    output << "{\n  \"schemaVersion\": \"phase-0-spike.1\",\n";
    output << "  \"source\": \"" << escape_json(source) << "\",\n";
    output << "  \"prototypes\": [\n";
    std::size_t prototype_index = 0;
    for (const auto& [prototype_id, prototype] : prototypes_) {
      output << "    {\"id\": \"" << escape_json(prototype_id)
             << "\", \"sourceLabel\": \"" << escape_json(prototype.source_label)
             << "\", \"faceCount\": " << prototype.face_count
             << ", \"edgeSourceRefs\": [";
      for (std::size_t edge_index = 0; edge_index < prototype.edge_source_refs.size(); ++edge_index) {
        if (edge_index != 0) output << ", ";
        output << "\"" << escape_json(prototype.edge_source_refs[edge_index]) << "\"";
      }
      output << "]}" << (++prototype_index == prototypes_.size() ? "\n" : ",\n");
    }
    output << "  ],\n  \"occurrences\": [\n";
    for (std::size_t occurrence_index = 0; occurrence_index < occurrences_.size(); ++occurrence_index) {
      const auto& occurrence = occurrences_[occurrence_index];
      output << "    {\"id\": \"" << escape_json(occurrence.id)
             << "\", \"parentId\": ";
      if (occurrence.parent_id.empty()) {
        output << "null";
      } else {
        output << "\"" << escape_json(occurrence.parent_id) << "\"";
      }
      output << ", \"prototypeId\": \"" << escape_json(occurrence.prototype_id)
             << "\", \"sourceLabel\": \"" << escape_json(occurrence.source_label)
             << "\", \"transform\": [";
      for (std::size_t matrix_index = 0; matrix_index < occurrence.transform.size(); ++matrix_index) {
        if (matrix_index != 0) output << ", ";
        output << occurrence.transform[matrix_index];
      }
      output << "]}" << (occurrence_index + 1 == occurrences_.size() ? "\n" : ",\n");
    }
    output << "  ],\n  \"diagnostics\": []\n}\n";
  }

 private:
  void ensure_prototype(const std::string& prototype_id, const TDF_Label& prototype_label) {
    if (prototypes_.contains(prototype_id)) return;

    const TopoDS_Shape shape = shape_tool_->GetShape(prototype_label);
    PrototypeRecord prototype;
    prototype.source_label = label_entry(prototype_label);
    prototype.face_count = count_subshapes(shape, TopAbs_FACE);
    const std::size_t edge_count = count_subshapes(shape, TopAbs_EDGE);
    prototype.edge_source_refs.reserve(edge_count);
    for (std::size_t edge_index = 0; edge_index < edge_count; ++edge_index) {
      prototype.edge_source_refs.push_back(
          prototype_id + ":edge:" + std::to_string(edge_index));
    }
    prototypes_.emplace(prototype_id, std::move(prototype));
  }

  Handle(XCAFDoc_ShapeTool) shape_tool_;
  std::map<std::string, PrototypeRecord> prototypes_;
  std::vector<OccurrenceRecord> occurrences_;
};

}  // namespace

int main(const int argc, const char* const argv[]) {
  if (argc != 2) {
    std::cerr << "usage: naru-occt-spike <assembly.step>\n";
    return EXIT_FAILURE;
  }

  const std::string source_path = argv[1];
  STEPCAFControl_Reader reader;
  reader.SetNameMode(true);
  reader.SetColorMode(true);
  reader.SetLayerMode(true);

  if (reader.ReadFile(source_path.c_str()) != IFSelect_RetDone) {
    std::cerr << "failed to read STEP source: " << source_path << '\n';
    return EXIT_FAILURE;
  }

  Handle(TDocStd_Document) document;
  XCAFApp_Application::GetApplication()->NewDocument("BinXCAF", document);
  if (!reader.Transfer(document)) {
    std::cerr << "failed to transfer STEP source into XDE\n";
    return EXIT_FAILURE;
  }

  const Handle(XCAFDoc_ShapeTool) shape_tool =
      XCAFDoc_DocumentTool::ShapeTool(document->Main());
  TDF_LabelSequence roots;
  shape_tool->GetFreeShapes(roots);
  if (roots.IsEmpty()) {
    std::cerr << "STEP source contains no free shapes\n";
    return EXIT_FAILURE;
  }

  try {
    Extractor extractor(shape_tool);
    for (Standard_Integer index = 1; index <= roots.Length(); ++index) {
      extractor.visit(roots.Value(index), "");
    }
    extractor.write_json(std::cout, source_path);
  } catch (const std::exception& error) {
    std::cerr << "OCCT extraction failed: " << error.what() << '\n';
    return EXIT_FAILURE;
  }

  return EXIT_SUCCESS;
}
