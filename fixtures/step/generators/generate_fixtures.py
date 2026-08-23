"""Generate the canonical MADI Phase 0 STEP fixtures.

The committed STEP files are the test inputs. This script documents their
construction and lets maintainers intentionally regenerate them with the
toolchain versions recorded in ``manifest.json``.
"""

from __future__ import annotations

import re
from pathlib import Path

import cadquery as cq
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.Interface import Interface_Static
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_StepModelType
from OCP.XSControl import XSControl_WorkSession
from cadquery.occ_impl.assembly import toCAF
from cadquery.occ_impl.exporters.assembly import exportAssembly


FIXTURE_DIRECTORY = Path(__file__).resolve().parent.parent
FIXED_TIMESTAMP = "2026-08-23T00:00:00"
UNSUPPORTED_LAYER_NAME = "MADI_PHASE0_UNMAPPED_LAYER"


def precision_bracket() -> cq.Workplane:
    """Return one B-rep with planar, cylindrical, and filleted surfaces."""

    plate = (
        cq.Workplane("XY")
        .rect(80.0, 48.0)
        .extrude(8.0)
        .edges("|Z")
        .fillet(6.0)
        .faces(">Z")
        .workplane()
        .pushPoints([(-25.0, 0.0), (25.0, 0.0)])
        .hole(8.0)
    )

    boss = cq.Workplane("XY").circle(14.0).extrude(18.0).faces(">Z").workplane().hole(12.0)
    bracket = plate.union(boss)

    # The upper circular edge creates a toroidal blend while the through-hole
    # retains cylindrical seams and explicit circular source edges.
    return bracket.edges(">Z and %CIRCLE").fillet(1.5)


def repeated_fastener_assembly() -> cq.Assembly:
    """Return a nested assembly that reuses one fastener prototype eight times."""

    base = (
        cq.Workplane("XY")
        .rect(96.0, 56.0)
        .extrude(6.0)
        .edges("|Z")
        .fillet(5.0)
        .faces(">Z")
        .workplane()
        .pushPoints([(-32.0, -16.0), (-32.0, 16.0), (32.0, -16.0), (32.0, 16.0)])
        .hole(7.0)
    )
    rail = cq.Workplane("XY").box(70.0, 10.0, 10.0).translate((0.0, 0.0, 6.0))
    fastener = (
        cq.Workplane("XY")
        .circle(3.0)
        .extrude(12.0)
        .faces(">Z")
        .workplane()
        .polygon(6, 10.0)
        .extrude(4.0)
    )

    fastener_bank = cq.Assembly(name="fastener-bank")
    positions = [
        (-32.0, -16.0),
        (-32.0, 16.0),
        (32.0, -16.0),
        (32.0, 16.0),
        (-24.0, 0.0),
        (-8.0, 0.0),
        (8.0, 0.0),
        (24.0, 0.0),
    ]
    for index, (x, y) in enumerate(positions, start=1):
        fastener_bank.add(
            fastener,
            name=f"fastener-{index:02d}",
            color=cq.Color(0.72, 0.74, 0.78),
            loc=cq.Location((x, y, 6.0)),
        )

    assembly = cq.Assembly(name="madi-repeated-fasteners")
    assembly.add(base, name="mounting-plate", color=cq.Color(0.18, 0.34, 0.62))
    assembly.add(rail, name="center-rail", color=cq.Color(0.92, 0.48, 0.12))
    assembly.add(fastener_bank, name="fastener-bank")
    return assembly


def export_ap242_assembly(assembly: cq.Assembly, path: Path) -> None:
    """Export an XDE assembly with OCCT's AP242 DIS schema selection."""

    _, document = toCAF(assembly, True)
    session = XSControl_WorkSession()
    writer = STEPCAFControl_Writer(session, False)
    writer.SetColorMode(True)
    writer.SetLayerMode(True)
    writer.SetNameMode(True)
    Interface_Static.SetIVal_s("write.surfacecurve.mode", 1)
    Interface_Static.SetIVal_s("write.precision.mode", 0)
    Interface_Static.SetIVal_s("write.stepcaf.subshapes.name", 1)
    Interface_Static.SetCVal_s("xstep.cascade.unit", "MM")
    Interface_Static.SetCVal_s("write.step.unit", "MM")
    if not Interface_Static.SetCVal_s("write.step.schema", "AP242DIS"):
        raise RuntimeError("OCCT did not accept the AP242 schema selection")
    writer.ChangeWriter().Model(True)
    if not writer.Transfer(document, STEPControl_StepModelType.STEPControl_AsIs):
        raise RuntimeError("OCCT failed to transfer the AP242 assembly")
    if writer.Write(str(path)) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f"OCCT failed to write {path}")


def canonicalize_header(path: Path) -> None:
    """Remove machine path and wall-clock variance from an exported STEP header."""

    content = path.read_text(encoding="utf-8")
    file_name = (
        f"FILE_NAME('{path.name}','{FIXED_TIMESTAMP}',"
        "('MADI Contributors'),('MADI'),'Open CASCADE STEP processor 7.9.3',"
        "'CadQuery 2.8.0','');"
    )
    canonical, substitutions = re.subn(
        r"FILE_NAME\(.*?\);",
        file_name,
        content,
        count=1,
        flags=re.DOTALL,
    )
    if substitutions != 1:
        raise RuntimeError(f"Expected exactly one FILE_NAME header in {path}")
    path.write_text(canonical.replace("\r\n", "\n"), encoding="utf-8", newline="\n")


def add_unsupported_layer_assignment(source: Path, target: Path) -> None:
    """Copy a valid assembly and add one intentionally unmapped AP214 entity.

    Presentation layers are meaningful engineering metadata, but Phase 0 does
    not claim a layer capability. Keeping the assignment in a separate fixture
    lets the evidence harness prove that supported B-rep geometry survives
    while the omitted semantic data produces a stable diagnostic.
    """

    content = source.read_text(encoding="utf-8")
    entity_ids = [int(value) for value in re.findall(r"^#(\d+)\s*=", content, re.MULTILINE)]
    brep_match = re.search(
        r"^#(\d+)\s*=\s*MANIFOLD_SOLID_BREP\b",
        content,
        re.MULTILINE,
    )
    if not entity_ids or brep_match is None:
        raise RuntimeError(f"Could not find STEP entity IDs and a B-rep in {source}")

    entity_id = max(entity_ids) + 1
    brep_id = brep_match.group(1)
    assignment = (
        f"#{entity_id} = PRESENTATION_LAYER_ASSIGNMENT("
        f"'{UNSUPPORTED_LAYER_NAME}',"
        "'Intentionally unsupported by the MADI Phase 0 adapter',"
        f"(#{brep_id}));"
    )
    trailer = "\nENDSEC;\nEND-ISO-10303-21;"
    if content.count(trailer) != 1:
        raise RuntimeError(f"Expected one STEP DATA trailer in {source}")

    target.write_text(
        content.replace(trailer, f"\n{assignment}{trailer}"),
        encoding="utf-8",
        newline="\n",
    )


def main() -> None:
    precision_path = FIXTURE_DIRECTORY / "precision-bracket.step"
    assembly_path = FIXTURE_DIRECTORY / "repeated-fasteners.step"
    ap242_assembly_path = FIXTURE_DIRECTORY / "repeated-fasteners-ap242.step"
    unsupported_path = FIXTURE_DIRECTORY / "unsupported-layer-assignment.step"

    cq.exporters.export(
        precision_bracket(),
        str(precision_path),
        exportType="STEP",
        unit="MM",
        opt={"write_pcurves": True, "precision_mode": 0},
    )
    if not exportAssembly(
        repeated_fastener_assembly(),
        str(assembly_path),
        unit="MM",
        write_pcurves=True,
        precision_mode=0,
    ):
        raise RuntimeError("CadQuery failed to export repeated-fasteners.step")
    export_ap242_assembly(repeated_fastener_assembly(), ap242_assembly_path)

    canonicalize_header(precision_path)
    canonicalize_header(assembly_path)
    canonicalize_header(ap242_assembly_path)
    add_unsupported_layer_assignment(assembly_path, unsupported_path)
    canonicalize_header(unsupported_path)

    print(f"generated {precision_path}")
    print(f"generated {assembly_path}")
    print(f"generated {ap242_assembly_path}")
    print(f"generated {unsupported_path}")


if __name__ == "__main__":
    main()
