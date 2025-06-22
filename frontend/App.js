// frontend/App.js
import React, { useState } from 'react';
import { Button, FlatList, Text, TextInput, View, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

function HomeScreen({ navigation }) {
  const [location, setLocation] = useState('Oak Lawn');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text>Location:</Text>
      <TextInput
        value={location}
        onChangeText={setLocation}
        style={{ borderWidth: 1, padding: 8, marginBottom: 16 }}
      />

      <Text>Start Date (YYYY-MM-DD):</Text>
      <TextInput
        value={startDate}
        onChangeText={setStartDate}
        style={{ borderWidth: 1, padding: 8, marginBottom: 16 }}
      />

      <Text>End Date (YYYY-MM-DD):</Text>
      <TextInput
        value={endDate}
        onChangeText={setEndDate}
        style={{ borderWidth: 1, padding: 8, marginBottom: 16 }}
      />

      <Button
        title="Fetch Visits"
        onPress={() => {
          navigation.navigate('Results', { location, startDate, endDate });
        }}
      />
    </View>
  );
}

function ResultsScreen({ route }) {
  const { location, startDate, endDate } = route.params;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    const q = startDate && endDate
      ? `locations[]=${encodeURIComponent(location)}&startDate=${startDate}&endDate=${endDate}`
      : `location=${encodeURIComponent(location)}&date=${startDate}`;
    fetch(`http://localhost:4000/api/sync?${q}`)
      .then(r => r.json())
      .then(() => {
        // after sync, pull the actual visits from your backend
        return fetch(`http://localhost:4000/api/visits?location=${encodeURIComponent(location)}&startDate=${startDate}&endDate=${endDate}`);
      })
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <View style={{ flex:1,justifyContent:'center',alignItems:'center' }}><Text>Loading…</Text></View>;
  }

  return (
    <FlatList
      data={data}
      keyExtractor={(item, i) => `${item.patient}-${item.time}-${i}`}
      renderItem={({ item }) => (
        <View style={{ padding: 12, borderBottomWidth: 1 }}>
          <Text>{item.date} • {item.time} • {item.patient}</Text>
          <Text>Dr: {item.doctor} – {item.type} – {item.status}</Text>
        </View>
      )}
    />
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Results" component={ResultsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
