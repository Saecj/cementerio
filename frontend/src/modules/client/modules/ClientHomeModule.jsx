import { HomeView } from '../../home/HomeView'

export function ClientHomeModule({ me, onLogin, onPayReservation, onGoToMyReservations }) {
	return <HomeView me={me} onLogin={onLogin} onPayReservation={onPayReservation} onGoToMyReservations={onGoToMyReservations} />
}
