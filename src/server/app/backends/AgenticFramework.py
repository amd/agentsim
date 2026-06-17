from abc import ABC, abstractmethod

from app.models import Message


class AgenticFramework(ABC):
    name: str
    alias: str
    data_basepath: str

    @abstractmethod
    def init(self) -> None:

    @abstractmethod
    def get_sessions_list(self) -> [str]:

    @abstractmethod
    def get_session_trace_data(self, session_id) -> SessionTraceData:
