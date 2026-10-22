# Generated from packages/schema/music-index.schema.json by `pnpm gen`; do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class License(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Annotated[
        str, Field(description="e.g. CC BY 4.0, or the library's licence name.", min_length=1)
    ]
    url: Annotated[str | None, Field(min_length=1)] = None
    attribution: Annotated[
        str | None, Field(description="The credit line the licence asks for.", min_length=1)
    ] = None


class Tempo(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    bpm: Annotated[
        float | None,
        Field(
            description="Beats per minute from the median time over 8 beats; null with fewer than two beats.",
            gt=0.0,
        ),
    ]
    beats_per_bar: Annotated[
        int | None,
        Field(
            description="The most common number of beats from one downbeat to the next; null with fewer than two downbeats.",
            ge=1,
        ),
    ]


class Seconds(RootModel[float]):
    root: Annotated[float, Field(ge=0.0)]


class Lufs(RootModel[float]):
    root: Annotated[
        float,
        Field(
            description="Loudness units relative to full scale, to 0.1; -70 for silence.", ge=-70.0
        ),
    ]


class Section(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    start: Annotated[float, Field(ge=0.0)]
    end: Annotated[float, Field(ge=0.0)]
    loudness: Annotated[
        float,
        Field(
            description="Integrated loudness of the section, gated as BS.1770 gates a programme.",
            ge=-70.0,
        ),
    ]


class Source(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Annotated[str, Field(description="The file name, without its folder.")]
    duration: Annotated[float, Field(description="Seconds of decoded sound.", ge=0.0)]
    sample_rate: Annotated[
        int,
        Field(
            description="The first audio stream's own rate; the analysis decodes it at 48 kHz.",
            ge=1,
        ),
    ]
    channels: Annotated[int, Field(description="The first audio stream's own.", ge=1)]


class MusicIndex(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    version: Literal[1]
    source: Source
    license: Annotated[
        License,
        Field(
            description="Why this track may be used, as the person who supplied it stated it; the project copies it and the renderer writes it next to every output that plays the track."
        ),
    ]
    tracker: Annotated[
        str,
        Field(
            description="The beat tracker and model that found the beats, e.g. beat_this final0; none when the beat model could not be downloaded, which leaves the beats, the downbeats and the tempo empty and the whole track one section.",
            min_length=1,
        ),
    ]
    tempo: Tempo
    beats: Annotated[
        list[Seconds],
        Field(
            description="Every beat while the track sounds, in time order, to the tracker's 20 ms frames."
        ),
    ]
    downbeats: Annotated[
        list[Seconds], Field(description="The beats that start a bar, in time order.")
    ]
    sections: Annotated[
        list[Section],
        Field(
            description="Consecutive stretches that sound alike, covering the track from 0 to `end`. Every boundary but the first is a downbeat where the bars before and after differ most in loudness and timbre, so a section starts a phrase."
        ),
    ]
    loudness: Annotated[
        list[Lufs],
        Field(
            description="Short-term EBU R128 loudness of every second, as the media index's `short_term`, but measured at the track's own 48 kHz and with its channels weighed apart, as BS.1770 sums them: the track's energy over time."
        ),
    ]
    end: Annotated[
        float,
        Field(
            description="Where the track's sound dies away: after this, nothing louder than 50 dB under its peak. An edit that ends on the music's ending ends here.",
            ge=0.0,
        ),
    ]
